import type { LLMMessage } from "@/lib/llm/types";
import type { LLMProvider } from "@/lib/llm/provider";
import type { WorkspaceContext, ProposedUpdate } from "../state";
import type { ToolDefinition } from "../tools";
import type { SubAgentConfig, SubAgentResult, SubAgentProgress } from "./types";
import { TOOL_SCHEMAS } from "../tool-schemas";
import { executeTool } from "../tool-dispatcher";
import { getSubAgentConfig } from "./configs";
import { getProviderCatalog } from "@/lib/llm/provider-catalog";
import { loadRuntimeSkillByName, type RuntimeSkill } from "@/lib/skills/runtime";
import { classifyUpdateRisk } from "../review-policy";
import { applyProposedUpdate } from "@/lib/workspace/apply-update";
import { FINISH_SUBAGENT_SENTINEL, type SubAgentHandoff } from "../tools/finish-subagent";

// ── Sub-Agent Runner ───────────────────────────────────────────────────────

export async function runSubAgent(input: {
  provider: LLMProvider;
  agentId: string;
  type: string;
  goal: string;
  context?: string;
  skill?: string;
  workspace: WorkspaceContext;
  homeDir?: string;
  signal?: AbortSignal;
  onProgress?: (progress: SubAgentProgress) => void;
}): Promise<SubAgentResult> {
  const config = getSubAgentConfig(input.type);
  if (!config) {
    return {
      summary: `Unknown sub-agent type: "${input.type}". Available types: explore, research.`,
      toolCallCount: 0,
      durationMs: 0,
      hitLimit: false,
    };
  }

  const startTime = Date.now();
  const workspaceRoot = input.workspace.workspaceDir ?? process.cwd();

  // Load skill if specified
  let skillPrompt: string | undefined;
  if (input.skill) {
    const skill = await loadRuntimeSkillByName({ homeDir: input.homeDir, name: input.skill });
    if (skill) {
      skillPrompt = skill.prompt;
    }
  }

  // Build tool set: filter TOOL_SCHEMAS to only allowed tools
  // Also include the finish_subagent schema if it's in allowedTools
  const tools: ToolDefinition[] = TOOL_SCHEMAS.filter((t) =>
    config.allowedTools.has(t.function.name)
  );

  // Add finish_subagent schema if allowed (it's not in the main TOOL_SCHEMAS)
  if (config.allowedTools.has("finish_subagent")) {
    tools.push(FINISH_SUBAGENT_SCHEMA);
  }

  // Build isolated message history
  const userMessage = input.context
    ? `## Goal\n${input.goal}\n\n## Context from lead researcher\n${input.context}`
    : input.goal;

  const messages: LLMMessage[] = [
    { role: "system", content: config.buildSystemPrompt(workspaceRoot, skillPrompt) },
    { role: "user", content: userMessage },
  ];

  let totalToolCalls = 0;
  let iterations = 0;
  let handoff: SubAgentHandoff | undefined;
  let activeSkills: RuntimeSkill[] = [];

  function emitProgress(currentTool: string, status: "running" | "done" = "running") {
    input.onProgress?.({
      agentId: input.agentId,
      agentType: input.type,
      goal: input.goal,
      currentTool,
      toolCount: totalToolCalls,
      status,
    });
  }

  emitProgress("");

  // ── Agent loop ─────────────────────────────────────────────────────────
  for (;;) {
    if (input.signal?.aborted) break;
    if (iterations >= config.maxIterations) break;
    if (handoff) break; // Sub-agent called finish_subagent
    iterations++;

    if (iterations > 1) emitProgress("");

    let fullText = "";
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const chunk of input.provider.callLLMStreaming({
      messages,
      tools,
      model: config.model ?? getProviderCatalog(input.provider.kind).backgroundModel,
      reasoningEffort: config.reasoningEffort,
      signal: input.signal,
    })) {
      if (input.signal?.aborted) break;
      if (chunk.type === "text_delta") {
        fullText += chunk.content;
      } else if (chunk.type === "done") {
        toolCalls = chunk.toolCalls;
      }
    }

    if (input.signal?.aborted) break;

    // No tool calls → sub-agent is done (natural completion without finish_subagent)
    if (toolCalls.length === 0) {
      emitProgress("", "done");
      return {
        summary: fullText || "(Sub-agent returned empty response)",
        toolCallCount: totalToolCalls,
        durationMs: Date.now() - startTime,
        hitLimit: false,
        handoff,
      };
    }

    // Execute tool calls
    messages.push({
      role: "assistant",
      content: fullText || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const toolCall of toolCalls) {
      if (input.signal?.aborted) break;
      if (handoff) break; // Already finished
      totalToolCalls++;

      const args = JSON.parse(toolCall.arguments || "{}");
      const description = describeSubAgentTool(toolCall.name, args);

      emitProgress(description);

      // Handle finish_subagent specially — capture handoff and stop
      if (toolCall.name === "finish_subagent") {
        const { executeFinishSubagent } = await import("../tools/finish-subagent");
        const finishResult = executeFinishSubagent(args);
        handoff = finishResult.handoff;

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: "Task completed. Handoff report captured.",
        });
        continue;
      }

      const result = await executeTool(
        toolCall.name,
        args,
        input.workspace,
        activeSkills,
        input.homeDir,
        input.signal,
        input.provider,
        undefined, // no nested sub-agent progress
        toolCall.id,
      );

      // Handle proposed updates — apply via review policy
      if (result.proposedUpdate && input.workspace.workspaceDir) {
        const risk = classifyUpdateRisk(result.proposedUpdate);
        if (risk.policy === "auto-apply") {
          await applyProposedUpdate(input.workspace.workspaceDir, result.proposedUpdate);
          // Update workspace context so subsequent tools see the new file
          input.workspace.workspaceFiles[result.proposedUpdate.key] = result.proposedUpdate.content;
          if (!input.workspace.availableKeys.includes(result.proposedUpdate.key)) {
            input.workspace.availableKeys.push(result.proposedUpdate.key);
          }
        }
        // Non-auto-apply updates are silently dropped for sub-agents
        // (they can only write to managed safe paths)
      }

      // Handle skill loading within sub-agent
      if (result.loadedSkillId) {
        const skill = await loadRuntimeSkillByName({ homeDir: input.homeDir, name: result.loadedSkillId });
        if (skill && !activeSkills.find((s) => s.id === skill.id)) {
          activeSkills.push(skill);
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.result,
      });
    }
  }

  // If we have a handoff, return it
  if (handoff) {
    emitProgress("", "done");
    return {
      summary: handoff.summary,
      toolCallCount: totalToolCalls,
      durationMs: Date.now() - startTime,
      hitLimit: false,
      handoff,
    };
  }

  // Hit iteration limit — ask model to summarize and produce a handoff
  if (!input.signal?.aborted && iterations >= config.maxIterations) {
    emitProgress("Summarizing findings...");

    messages.push({
      role: "user",
      content: "You've reached the iteration limit. Call `finish_subagent` now with a summary of what you've accomplished so far.",
    });

    let finalText = "";
    let finalToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const chunk of input.provider.callLLMStreaming({
      messages,
      tools: tools.filter((t) => t.function.name === "finish_subagent"),
      model: config.model ?? getProviderCatalog(input.provider.kind).backgroundModel,
      reasoningEffort: config.reasoningEffort,
      signal: input.signal,
    })) {
      if (chunk.type === "text_delta") finalText += chunk.content;
      if (chunk.type === "done") finalToolCalls = chunk.toolCalls;
    }

    // Try to capture the finish_subagent call
    for (const tc of finalToolCalls) {
      if (tc.name === "finish_subagent") {
        const { executeFinishSubagent } = await import("../tools/finish-subagent");
        const args = JSON.parse(tc.arguments || "{}");
        const finishResult = executeFinishSubagent(args);
        handoff = finishResult.handoff;
        handoff.status = "partial"; // Override — hit limit means partial
      }
    }

    emitProgress("", "done");
    return {
      summary: handoff?.summary ?? (finalText || "(Sub-agent hit iteration limit)"),
      toolCallCount: totalToolCalls,
      durationMs: Date.now() - startTime,
      hitLimit: true,
      handoff,
    };
  }

  emitProgress("", "done");
  return {
    summary: "(Sub-agent interrupted)",
    toolCallCount: totalToolCalls,
    durationMs: Date.now() - startTime,
    hitLimit: false,
  };
}

// ── finish_subagent Tool Schema ──────────────────────────────────────────
// Defined here (not in tool-schemas.ts) because it's only available to sub-agents.

const FINISH_SUBAGENT_SCHEMA: ToolDefinition = {
  type: "function",
  function: {
    name: "finish_subagent",
    description:
      "Call this when your task is complete. Provides a structured handoff report to the lead researcher. " +
      "You MUST call this when done — do not just stop responding.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "What you accomplished (2-3 sentences).",
        },
        files_created: {
          type: "array",
          items: { type: "string" },
          description: "Files you created (e.g., 'notes/source-scout-report.md').",
        },
        files_modified: {
          type: "array",
          items: { type: "string" },
          description: "Files you edited.",
        },
        key_findings: {
          type: "array",
          items: { type: "string" },
          description: "3-5 bullet points of your most important discoveries.",
        },
        status: {
          type: "string",
          enum: ["completed", "partial", "blocked"],
          description: "'completed' if fully done, 'partial' if progress made but unfinished, 'blocked' if stuck.",
        },
        blocked_reason: {
          type: "string",
          description: "Why you couldn't finish (only if status is partial or blocked).",
        },
      },
      required: ["summary", "key_findings", "status"],
      additionalProperties: false,
    },
  },
};

// ── Tool Description Helpers ───────────────────────────────────────────────

function describeSubAgentTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read_file":
      return `Reading ${args.file_path ?? "file"}`;
    case "read_pdf":
      return `Reading PDF ${args.file_path ?? ""}`;
    case "list_directory":
      return `Listing ${args.dir_path ?? "directory"}`;
    case "search_workspace": {
      const queries = args.queries as string[] | undefined;
      return queries?.length ? `Searching "${queries[0]}"` : "Searching workspace";
    }
    case "write_new_file":
      return `Creating ${args.key ?? "file"}`;
    case "update_existing_file":
      return `Editing ${args.key ?? "file"}`;
    case "run_command": {
      const desc = args.description as string | undefined;
      return desc || `Running: ${(args.command as string)?.slice(0, 40) ?? "command"}`;
    }
    case "search_external_sources":
      return `Searching papers: "${(args.target as string)?.slice(0, 40) ?? ""}"`;
    case "web_search":
      return `Web search: "${(args.target as string)?.slice(0, 40) ?? ""}"`;
    case "traverse_citations":
      return `Traversing citations: ${args.direction ?? ""}`;
    case "fetch_url":
      return `Fetching URL`;
    case "finish_subagent":
      return "Finishing task";
    default:
      return name;
  }
}
