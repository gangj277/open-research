import type { LLMMessage } from "@/lib/llm/types";
import type { LLMProvider } from "@/lib/llm/provider";
import type { WorkspaceContext } from "../state";
import type { ToolDefinition } from "../tools";
import type { SubAgentConfig, SubAgentResult, SubAgentProgress } from "./types";
import { TOOL_SCHEMAS } from "../tool-schemas";
import { executeTool } from "../tool-dispatcher";
import { getSubAgentConfig } from "./configs";
import { getProviderCatalog } from "@/lib/llm/provider-catalog";

// ── Sub-Agent Runner ───────────────────────────────────────────────────────

/**
 * Run a sub-agent to completion. The sub-agent gets its own isolated message
 * history, a subset of tools, and runs until it produces a final text response
 * (no more tool calls) or hits the iteration limit.
 *
 * Returns the sub-agent's final summary and execution metadata.
 */
export async function runSubAgent(input: {
  provider: LLMProvider;
  agentId: string;
  type: string;
  goal: string;
  context?: string;
  workspace: WorkspaceContext;
  homeDir?: string;
  signal?: AbortSignal;
  /** Called with live progress updates for TUI rendering */
  onProgress?: (progress: SubAgentProgress) => void;
}): Promise<SubAgentResult> {
  const config = getSubAgentConfig(input.type);
  if (!config) {
    return {
      summary: `Unknown sub-agent type: "${input.type}". Available types: explore.`,
      toolCallCount: 0,
      durationMs: 0,
      hitLimit: false,
    };
  }

  const startTime = Date.now();
  const workspaceRoot = input.workspace.workspaceDir ?? process.cwd();

  // Build tool set: filter TOOL_SCHEMAS to only allowed tools
  const tools: ToolDefinition[] = TOOL_SCHEMAS.filter((t) =>
    config.allowedTools.has(t.function.name)
  );

  // Build isolated message history
  const userMessage = input.context
    ? `## Goal\n${input.goal}\n\n## Context from lead researcher\n${input.context}`
    : input.goal;

  const messages: LLMMessage[] = [
    { role: "system", content: config.buildSystemPrompt(workspaceRoot) },
    { role: "user", content: userMessage },
  ];

  let totalToolCalls = 0;
  let iterations = 0;

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

  // Initial progress — thinking
  emitProgress("");

  // ── Agent loop ─────────────────────────────────────────────────────────
  for (;;) {
    if (input.signal?.aborted) break;
    if (iterations >= config.maxIterations) break;
    iterations++;

    // Emit thinking state between tool rounds
    if (iterations > 1) emitProgress("");

    // LLM call (non-streaming — sub-agents don't need to stream to TUI)
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

    // No tool calls → sub-agent is done
    if (toolCalls.length === 0) {
      emitProgress("", "done");
      return {
        summary: fullText || "(Sub-agent returned empty response)",
        toolCallCount: totalToolCalls,
        durationMs: Date.now() - startTime,
        hitLimit: false,
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
      totalToolCalls++;

      const args = JSON.parse(toolCall.arguments || "{}");
      const description = describeSubAgentTool(toolCall.name, args);

      // Emit tool-start progress
      emitProgress(description);

      const result = await executeTool(
        toolCall.name,
        args,
        input.workspace,
        [], // no active skills for sub-agents
        input.homeDir,
        input.signal
      );

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.result,
      });
    }
  }

  // Hit iteration limit or aborted — ask the model to summarize what it found
  if (!input.signal?.aborted && iterations >= config.maxIterations) {
    emitProgress("Summarizing findings...");

    messages.push({
      role: "user",
      content: "You've reached the exploration limit. Summarize your findings so far based on what you've already read. Be concise and conclusion-oriented.",
    });

    let finalText = "";
    for await (const chunk of input.provider.callLLMStreaming({
      messages,
      model: config.model ?? getProviderCatalog(input.provider.kind).backgroundModel,
      reasoningEffort: config.reasoningEffort,
      signal: input.signal,
    })) {
      if (chunk.type === "text_delta") finalText += chunk.content;
    }

    emitProgress("", "done");
    return {
      summary: finalText || "(Sub-agent hit iteration limit with no summary)",
      toolCallCount: totalToolCalls,
      durationMs: Date.now() - startTime,
      hitLimit: true,
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
    default:
      return name;
  }
}
