import type { LLMMessage } from "@/lib/llm/types";
import type { LLMProvider } from "@/lib/llm/provider";
import type { ToolExecutionResult } from "./tools";
import { TOOL_SCHEMAS, isParallelSafe } from "./tool-schemas";
import type { ProposedUpdate, WorkspaceContext } from "./state";
import { executeTool, type ToolBridges } from "./tool-dispatcher";
import type { QuestionBridge } from "./tools/ask-user";
import type { ServerEvent } from "@/server/types";
import type { SubAgentProgress } from "./subagent";
import { loadRuntimeSkillByName, type RuntimeSkill } from "@/lib/skills/runtime";
import {
  createSessionUsage,
  updateUsageFromApi,
  maybeCompact,
  estimateConversationTokens,
  getContextWindow,
  type SessionTokenUsage,
} from "./context-manager";
import { loadAllMemories, selectRelevantMemories, formatMemoriesForPrompt } from "@/lib/memory/store";
import { extractAndStoreMemories } from "@/lib/memory/extractor";
import { readAgentsMd, maybeUpdateAgentsMd } from "@/lib/workspace/agents-md";
import { getCurrentTaskBlock } from "@/lib/agent/tools/current-task";
import { classifyUpdateRisk } from "./review-policy";
import { applyProposedUpdate } from "@/lib/workspace/apply-update";
import { selectModelForTask, getProviderCatalog } from "@/lib/llm/provider-catalog";

// ── Tool Activity Event ─────────────────────────────────────────────────────

export interface ToolActivity {
  type: "tool_start" | "tool_end";
  toolCallId: string;
  name: string;
  description?: string;
  durationMs?: number;
}

// ── Agent Turn Result ───────────────────────────────────────────────────────

export interface AgentTurnResult {
  text: string;
  proposedUpdates: ProposedUpdate[];
  activeSkills: RuntimeSkill[];
  searchResults: Array<{ title: string; url: string; provider: string }>;
  tokenUsage: SessionTokenUsage;
}

type PendingToolCall = { id: string; name: string; arguments: string };

interface ExecutedToolCall {
  toolCall: PendingToolCall;
  result: ToolExecutionResult;
  description: string;
  durationMs?: number;
}

// ── Tool Name → Human-Readable Description ──────────────────────────────────

const TOOL_DESCRIPTIONS: Record<string, (args: Record<string, unknown>) => string> = {
  read_file: (a) => `Reading ${a.file_path ?? "file"}`,
  read_pdf: (a) => `Reading PDF ${a.file_path ?? ""}`,
  list_directory: (a) => `Listing ${a.dir_path ?? "directory"}`,
  search_workspace: (a) => {
    const queries = a.queries as string[] | undefined;
    return queries?.length ? `Searching workspace for "${queries[0]}"` : "Searching workspace";
  },
  write_new_file: (a) => `Creating ${a.key ?? "file"}`,
  update_existing_file: (a) => `Editing ${a.key ?? "file"}`,
  run_command: (a) => {
    const desc = a.description as string | undefined;
    const cmd = a.command as string | undefined;
    return desc || `Running: ${cmd?.slice(0, 60) ?? "command"}`;
  },
  fetch_url: (a) => {
    const url = a.url as string | undefined;
    try {
      return `Fetching ${url ? new URL(url).hostname : "URL"}`;
    } catch {
      return `Fetching URL`;
    }
  },
  search_external_sources: (a) => {
    const target = a.target as string | undefined;
    return target ? `Searching papers: "${target.slice(0, 50)}"` : "Searching academic papers";
  },
  web_search: (a) => {
    const query = a.query as string | undefined;
    return `Web search: "${query?.slice(0, 50) ?? ""}"`;
  },
  ask_user: (a) => `Asking: ${(a.question as string)?.slice(0, 50) ?? "question"}`,
  load_skill: (a) => `Loading skill: ${a.skill_id ?? ""}`,
  read_skill_reference: (a) => `Reading skill reference: ${a.path ?? ""}`,
  create_paper: (a) => `Creating paper: ${a.title ?? ""}`,
  launch_subagent: (a) => {
    const type = a.type as string | undefined;
    const goal = a.goal as string | undefined;
    return `Sub-agent (${type ?? "explore"}): ${goal?.slice(0, 60) ?? "task"}`;
  },
  set_current_task: (a) => `Focus: ${(a.task as string)?.slice(0, 50) ?? ""}`
};

function describeToolCall(name: string, args: Record<string, unknown>): string {
  const fn = TOOL_DESCRIPTIONS[name];
  return fn ? fn(args) : `Running ${name}`;
}

function formatToolError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error executing ${toolName}: ${message}`;
}

function batchToolCalls(toolCalls: PendingToolCall[]): PendingToolCall[][] {
  const batches: PendingToolCall[][] = [];
  let currentParallelBatch: PendingToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (isParallelSafe(toolCall.name)) {
      currentParallelBatch.push(toolCall);
      continue;
    }

    if (currentParallelBatch.length > 0) {
      batches.push(currentParallelBatch);
      currentParallelBatch = [];
    }

    batches.push([toolCall]);
  }

  if (currentParallelBatch.length > 0) {
    batches.push(currentParallelBatch);
  }

  return batches;
}

// ── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: WorkspaceContext, activeSkills: RuntimeSkill[]): string {
  const skillText = activeSkills
    .map((skill) => `## Active Skill: ${skill.name}\n${skill.prompt}`)
    .join("\n\n");
  return [
    "You are Open Research — a research director who orchestrates specialized agents through a terminal CLI.",
    "Your primary mode: understand the user's research question, decompose it into steps, delegate each step to the right sub-agent, and synthesize findings into clear conclusions.",
    "",
    "## Decision: Delegate or Direct",
    "**Handle directly**: Quick lookups, single searches, clarifications, workspace edits, simple questions.",
    "**Delegate via sub-agent**: Multi-step research, literature reviews, experiments, evidence analysis, paper drafting — anything requiring sustained focus across many tool calls.",
    "When in doubt, delegate. Sub-agents have fresh context windows and work more deeply than you can in a single turn.",
    "",
    "## How You Work (Multi-Step Tasks)",
    "1. Set your focus: `set_current_task('Planning: ...')`",
    "2. Create a plan: `write_new_file` with key `path:run/archive/{YYYY-MM-DDTHH-MM-SS}/plan.md` — markdown checklist with context per step",
    "3. Delegate each step:",
    "   `launch_subagent(type: 'research', skill: 'source-scout', goal: '...', context: '...')`",
    "   Skills: source-scout, experiment-designer, data-analyst, devils-advocate, methodology-critic, evidence-adjudicator, novelty-checker, paper-explainer, draft-paper, reviewer-response",
    "4. Read the handoff report. Update the plan (check off items, add findings).",
    "5. Synthesize results for the user — conclusion first, then evidence, then caveats.",
    "For workspace exploration, use `launch_subagent(type: 'explore', ...)` (read-only, faster).",
    "",
    "## Writing Sub-Agent Instructions",
    "Sub-agents have ZERO context from this conversation. Your `goal` and `context` must be self-contained:",
    "- `goal`: Exactly what to accomplish. What output to produce. Where to write it.",
    "- `context`: What the user wants. What's already in the workspace. What to build on or skip.",
    "Trust sub-agent handoff reports. Do NOT re-do their work. Read the files they created if you need details.",
    "",
    "## Tools (for direct handling)",
    "- `read_file` / `read_pdf` / `list_directory` / `search_workspace` — explore workspace",
    "- `write_new_file` / `update_existing_file` — create and edit files (key prefixes: `note:`, `source:`, `paper:`, `experiment:`, `path:`)",
    "- `run_command` — execute shell commands (python, R, LaTeX, git, pip, etc.)",
    "- `search_external_sources` — academic paper search with auto-adversarial queries and evidence classification",
    "- `web_search` — web search with auto-adversarial queries (supports multiple queries)",
    "- `traverse_citations` — follow citation chains forward/backward from a paper",
    "- `fetch_url` — fetch a specific URL",
    "- `ask_user` — only for genuine ambiguity the workspace can't resolve",
    "- Invoke independent tools concurrently in a single response.",
    "",
    "## Evidence Standards",
    "- Every claim needs a citation. No \"studies show\" without attribution.",
    "- Weigh by evidence hierarchy: meta-analysis > experiment > observational > review > opinion.",
    "- Report methodology: sample sizes, study design, confidence levels.",
    "- When evidence conflicts, flag it — don't silently pick a side.",
    "",
    "## Communication",
    "- Conclusion first, evidence second, caveats third.",
    "- Match length to complexity. One-line answers for simple questions.",
    "- No filler. No \"Great question!\". No restating what the user said.",
    "- Use structured formats (bullets, tables) for complex findings.",
    "",
    "## Workspace Organization",
    "Use the correct key prefix when writing files:",
    "- `note:<slug>` → `notes/` — analysis, reviews, findings",
    "- `source:<slug>` → `sources/` — extracted paper/article text",
    "- `paper:<slug>` → `papers/` — LaTeX manuscripts",
    "- `experiment:<slug>` → `experiments/` — experiment definitions, results",
    "- `path:<relative/path>` → exact location — scripts, data, configs",
    "Use `folder` param to group: `note:findings` with folder `lit-review` → `notes/lit-review/findings.md`.",
    "",
    `## Workspace: ${process.cwd()}`,
    skillText,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Skill Parsing ───────────────────────────────────────────────────────────

async function parseRequestedSkills(message: string, homeDir?: string) {
  const matches = [...message.matchAll(/\/skill\s+([a-z0-9-]+)/gi)];
  const skills: RuntimeSkill[] = [];
  for (const match of matches) {
    const skill = await loadRuntimeSkillByName({ homeDir, name: match[1] });
    if (skill) {
      skills.push(skill);
    }
  }
  return skills;
}

// ── Agent Turn ──────────────────────────────────────────────────────────────

export async function runAgentTurn(input: {
  provider: LLMProvider;
  message: string;
  history: LLMMessage[];
  workspace: WorkspaceContext;
  homeDir?: string;
  model?: string;
  reasoningEffort?: import("@/lib/llm/types").ReasoningEffort;
  activeSkills?: RuntimeSkill[];
  onTextDelta?: (chunk: string) => void;
  onToolActivity?: (activity: ToolActivity) => void;
  onCompaction?: () => void;
  onTokenUpdate?: (usage: SessionTokenUsage) => void;
  /** Carry forward from previous turn for cumulative tracking */
  sessionUsage?: SessionTokenUsage;
  onMemoryExtracted?: (memories: string[]) => void;
  onAgentsMdUpdated?: () => void;
  onOntologyUpdated?: () => void;
  onSubAgentProgress?: (progress: SubAgentProgress) => void;
  signal?: AbortSignal;
  /** Injectable bridges for server mode (optional — falls back to module-level state) */
  questionBridge?: QuestionBridge;
  /** Emit all events to a server-side sink (optional — used alongside callbacks) */
  eventSink?: (event: ServerEvent) => void;
}): Promise<AgentTurnResult> {
  const requestedSkills = await parseRequestedSkills(input.message, input.homeDir);
  const activeSkills = [...(input.activeSkills ?? []), ...requestedSkills].filter(
    (skill, index, array) => array.findIndex((item) => item.id === skill.id) === index
  );

  const tools = TOOL_SCHEMAS;
  const systemPrompt = buildSystemPrompt(input.workspace, activeSkills);

  const model = input.model ?? getProviderCatalog(input.provider.kind).defaultModel;
  const usage = input.sessionUsage ?? createSessionUsage();

  // Load memories (global + project), select only relevant ones based on query
  const allMemories = await loadAllMemories({
    homeDir: input.homeDir,
    workspaceDir: input.workspace.workspaceDir,
  });
  const relevantMemories = selectRelevantMemories(allMemories, input.message);
  const memoryBlock = formatMemoriesForPrompt(relevantMemories);

  // Load project-level AGENTS.md
  const agentsMd = input.workspace.workspaceDir
    ? await readAgentsMd(input.workspace.workspaceDir).catch(() => "")
    : "";

  // Load task context (if tasks exist)
  const taskBlock = getCurrentTaskBlock();

  // Load ontology scaffolding (relevance agent + formatting)
  let ontologyBlock: string | null = null;
  if (input.workspace.workspaceDir) {
    try {
      const { loadOntology } = await import("@/lib/ontology/store");
      const { runRelevanceAgent } = await import("@/lib/ontology/relevance-agent");
      const { buildScaffoldingContext } = await import("@/lib/ontology/scaffolding");

      const ontology = await loadOntology(input.workspace.workspaceDir);
      const relevantIds = await runRelevanceAgent({
        userMessage: input.message,
        ontology,
        provider: input.provider,
      });
      ontologyBlock = buildScaffoldingContext(ontology, relevantIds);
    } catch {
      // Best-effort — continue without scaffolding
    }
  }

  const fullSystemPrompt = [
    systemPrompt,
    memoryBlock || null,
    agentsMd ? `## Project Context (from AGENTS.md)\n${agentsMd}` : null,
    ontologyBlock || null,
    taskBlock || null,
  ].filter(Boolean).join("\n\n");

  let messages: LLMMessage[] = [
    { role: "system", content: fullSystemPrompt },
    ...input.history,
    { role: "user", content: input.message },
  ];

  const proposedUpdates: ProposedUpdate[] = [];
  const searchResults: AgentTurnResult["searchResults"] = [];
  const collectedToolOutputs: Array<{ tool: string; input: string; output: string }> = [];
  const signal = input.signal;

  for (;;) {
    if (signal?.aborted) break;

    // ── Pre-turn compaction check ────────────────────────────────────────
    const { messages: compactedMsgs, didCompact } = await maybeCompact(
      messages, model, input.provider, usage, signal
    );
    if (didCompact) {
      messages = compactedMsgs;
      input.onCompaction?.();
      input.onTokenUpdate?.(usage);
    }

    // ── LLM call ────────────────────────────────────────────────────────
    let fullText = "";
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const chunk of input.provider.callLLMStreaming({
      messages,
      tools,
      model,
      reasoningEffort: input.reasoningEffort ?? "medium",
      signal,
    })) {
      if (signal?.aborted) break;
      if (chunk.type === "text_delta") {
        fullText += chunk.content;
        input.onTextDelta?.(chunk.content);
        input.eventSink?.({ type: "text_delta", content: chunk.content });
      } else if (chunk.type === "done") {
        toolCalls = chunk.toolCalls;
        // Update token usage from API response
        if (chunk.usage) {
          updateUsageFromApi(usage, chunk.usage);
          usage.estimatedCurrentTokens = estimateConversationTokens(messages);
          input.onTokenUpdate?.(usage);
        }
      }
    }

    if (signal?.aborted) break;

    // ── No tool calls → final response ──────────────────────────────────
    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content: fullText });

      // Background: extract memories + update AGENTS.md (fire-and-forget)
      extractAndStoreMemories({
        userMessage: input.message,
        agentResponse: fullText,
        provider: input.provider,
        model: selectModelForTask(input.provider.kind, input.model, "memory"),
        homeDir: input.homeDir,
        workspaceDir: input.workspace.workspaceDir,
      }).then((stored) => {
        if (stored.length > 0) {
          input.onMemoryExtracted?.(stored.map((m) => m.content));
        }
      }).catch(() => { /* best-effort */ });

      // Update project-level AGENTS.md in background
      if (input.workspace.workspaceDir) {
        maybeUpdateAgentsMd({
          workspaceDir: input.workspace.workspaceDir,
          userMessage: input.message,
          agentResponse: fullText,
          provider: input.provider,
          model: selectModelForTask(input.provider.kind, input.model, "workspace"),
        }).then((updated) => {
          if (updated) input.onAgentsMdUpdated?.();
        }).catch(() => { /* best-effort */ });
      }

      // Background: update ontology (serial queue, non-blocking)
      if (input.workspace.workspaceDir) {
        import("@/lib/ontology/manager-queue").then(({ enqueueOntologyManager }) => {
          enqueueOntologyManager({
            userMessage: input.message,
            agentResponse: fullText,
            toolOutputs: collectedToolOutputs,
            sessionId: "", // optional tracking
            turnIndex: 0,
            provider: input.provider,
            workspaceDir: input.workspace.workspaceDir!,
            onOntologyUpdated: input.onOntologyUpdated,
          });
        }).catch(() => { /* best-effort */ });
      }

      return {
        text: fullText,
        proposedUpdates,
        activeSkills,
        searchResults,
        tokenUsage: usage,
      };
    }

    // ── Execute tool calls ──────────────────────────────────────────────
    messages.push({
      role: "assistant",
      content: fullText || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    const executeSingleToolCall = async (toolCall: PendingToolCall): Promise<ExecutedToolCall> => {
      let args: Record<string, unknown>;

      try {
        args = JSON.parse(toolCall.arguments || "{}");
      } catch (error) {
        return {
          toolCall,
          result: { result: formatToolError(toolCall.name, error) },
          description: `Running ${toolCall.name}`,
        };
      }

      const description = describeToolCall(toolCall.name, args);
      const startActivity: ToolActivity = {
        type: "tool_start",
        toolCallId: toolCall.id,
        name: toolCall.name,
        description,
      };
      input.onToolActivity?.(startActivity);
      input.eventSink?.({ type: "tool_activity", activity: startActivity });

      const startTime = Date.now();
      try {
        const bridges: ToolBridges = {};
        if (input.questionBridge) bridges.questionBridge = input.questionBridge;

        const result = await executeTool(
          toolCall.name,
          args,
          input.workspace,
          activeSkills,
          input.homeDir,
          signal,
          input.provider,
          input.onSubAgentProgress,
          toolCall.id,
          bridges
        );
        const durationMs = Date.now() - startTime;
        const endActivity: ToolActivity = {
          type: "tool_end",
          toolCallId: toolCall.id,
          name: toolCall.name,
          description,
          durationMs,
        };
        input.onToolActivity?.(endActivity);
        input.eventSink?.({ type: "tool_activity", activity: endActivity });
        return { toolCall, result, description, durationMs };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errActivity: ToolActivity = {
          type: "tool_end",
          toolCallId: toolCall.id,
          name: toolCall.name,
          description,
          durationMs,
        };
        input.onToolActivity?.(errActivity);
        input.eventSink?.({ type: "tool_activity", activity: errActivity });
        return {
          toolCall,
          result: { result: formatToolError(toolCall.name, error) },
          description,
          durationMs,
        };
      }
    };

    for (const batch of batchToolCalls(toolCalls)) {
      if (signal?.aborted) break;

      const settled = await Promise.allSettled(batch.map((toolCall) => executeSingleToolCall(toolCall)));
      const completed = settled.map((entry, index): ExecutedToolCall => {
        if (entry.status === "fulfilled") {
          return entry.value;
        }

        const toolCall = batch[index]!;
        return {
          toolCall,
          result: { result: formatToolError(toolCall.name, entry.reason) },
          description: `Running ${toolCall.name}`,
        };
      });

      for (const { toolCall, result } of completed) {
        if (result.proposedUpdate) {
          proposedUpdates.push(result.proposedUpdate);
          // Auto-apply safe files immediately so they're accessible within the same turn
          if (input.workspace.workspaceDir) {
            const risk = classifyUpdateRisk(result.proposedUpdate);
            if (risk.policy === "auto-apply") {
              await applyProposedUpdate(input.workspace.workspaceDir, result.proposedUpdate);
              input.workspace.workspaceFiles[result.proposedUpdate.key] = result.proposedUpdate.content;
              if (!input.workspace.availableKeys.includes(result.proposedUpdate.key)) {
                input.workspace.availableKeys.push(result.proposedUpdate.key);
              }
            }
          }
        }
        if (result.searchResults) {
          searchResults.push(
            ...result.searchResults.map((item) => ({
              title: item.title,
              url: item.url,
              provider: item.provider,
            }))
          );
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.result,
        });

        // Collect for ontology manager
        collectedToolOutputs.push({
          tool: toolCall.name,
          input: toolCall.arguments,
          output: result.result,
        });
      }
    }
  }

  return {
    text: "Interrupted.",
    proposedUpdates,
    activeSkills,
    searchResults,
    tokenUsage: usage,
  };
}
