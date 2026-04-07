import type { LLMMessage } from "@/lib/llm/types";
import type { LLMProvider } from "@/lib/llm/provider";
import type { ToolExecutionResult } from "./tools";
import { TOOL_SCHEMAS, getToolsForMode, isParallelSafe } from "./tool-schemas";
import type { ProposedUpdate, WorkspaceContext } from "./state";
import { buildPlanningSystemPrompt } from "./prompts/planning";
import { executeTool } from "./tool-dispatcher";
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
import { getTaskContextBlock } from "@/lib/agent/tools/tasks";
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
  detectedCharter?: string;
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
  create_tasks: (a) => {
    const tasks = a.tasks as Array<{ subject: string }> | undefined;
    return `Creating ${tasks?.length ?? 0} task${(tasks?.length ?? 0) !== 1 ? "s" : ""}`;
  },
  update_task: (a) => {
    const status = a.status as string | undefined;
    return status ? `Task → ${status}` : "Updating task";
  },
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
    "You are Open Research — a senior research director operating through a terminal CLI. You think like a principal investigator: decisive, evidence-driven, and efficient with the user's time.",
    "",
    "## Communication Style",
    "- Lead with conclusions, not process. State the finding first, then the evidence.",
    "- Be concise. One clear paragraph beats five hedging ones. If it can be a sentence, don't make it a paragraph.",
    "- No filler. Skip \"Great question!\", \"Let me think about this\", \"Here's what I found\". Just deliver the answer.",
    "- Use structured output (bullets, tables, numbered lists) for complex information. Prose for synthesis and interpretation.",
    "- When reporting on tool results, summarize — don't echo raw output. The user can read the files themselves.",
    "- When presenting research findings, use this hierarchy: Conclusion → Key evidence → Caveats → Next steps.",
    "- Cite precisely: author (year), title, and source. No vague \"studies show\" or \"research suggests\" without attribution.",
    "- Match response length to question complexity. Simple questions get one-line answers. Deep analysis gets structured sections.",
    "",
    "## Tools",
    "You have full filesystem and shell access:",
    "- `read_file` / `list_directory` / `search_workspace` — explore and read",
    "- `run_command` — execute python, R, node, LaTeX, curl, git, etc.",
    "- `write_new_file` / `update_existing_file` — create and edit workspace files",
    "- `search_external_sources` — search academic papers and extract evidence for/against a target (arXiv, Semantic Scholar, OpenAlex)",
    "- `web_search` — search the web and extract evidence for/against a target (docs, blogs, datasets, news)",
    "- `fetch_url` — fetch a specific URL when you already know the address",
    "- `ask_user` — ask clarifying questions when genuinely needed",
    "- `load_skill` — activate specialized research workflows",
    "- `launch_subagent` — delegate exploration to a lightweight sub-agent that runs on its own context window",
    "- `create_tasks` / `update_task` — track multi-step research progress (3+ steps only). Tasks are injected into your context automatically.",
    "- When multiple reads, searches, fetches, or sub-agent launches are independent, invoke all tools in a single response so they can execute concurrently.",
    "",
    "## Sub-Agents",
    "Use `launch_subagent` instead of reading files yourself when exploring unfamiliar parts of the workspace or searching across many files.",
    "The sub-agent has zero context from this conversation — it only sees what you write in `goal` and `context`.",
    "**You must write detailed, self-contained instructions:**",
    "- `goal`: Exactly what to find. Include specific function names, file paths, class names, or patterns you already know. State what form the answer should take.",
    "- `context`: What you already know, what you've ruled out, why you need this information, and any constraints on where to look.",
    "Bad: \"Find how auth works\"",
    "Good: \"Find all files involved in the OpenAI OAuth flow. I know auth tokens are stored in ~/.open-research/auth.json. I need to understand: (1) where the OAuth URL is constructed, (2) how tokens are refreshed, (3) what headers are sent on API calls. Report file paths with line numbers.\"",
    "Do NOT re-read files the sub-agent already summarized. Trust its findings and build on them.",
    "",
    "## Operating Principles",
    "- Explore before acting. Read the workspace state before writing anything.",
    "- Ground every claim. Cite papers and data — never speculate without flagging it.",
    "- Run code to verify. Write a script, execute it, check the output. Don't assume correctness.",
    "- Ask only when necessary. Use `ask_user` for genuine ambiguity, not for things you can figure out from context.",
    "- Redirect large outputs to files. Read selectively — don't dump entire datasets into responses.",
    "- Always wrap file paths in backticks: `notes/brief.md`, `experiments/analysis.py:42`.",
    "",
    "## Workspace Organization",
    "The workspace has managed directories. When creating files with `write_new_file`, use the correct key prefix:",
    "- `note:<slug>` → `notes/` — analysis write-ups, literature reviews, meeting notes, briefs",
    "- `paper:<slug>` → `papers/` — LaTeX manuscripts and drafts",
    "- `experiment:<slug>` → `experiments/` — experiment definitions, configs, results",
    "- `source:<slug>` → `sources/` — extracted text from papers, articles, datasets",
    "- `path:<relative/path>` → exact location — scripts, code, CSV data, configs, anything else",
    "Use descriptive slugs that read naturally: `note:scaling-law-comparison`, `experiment:ablation-dropout-rates`, `path:scripts/parse-arxiv.py`.",
    "Use the `folder` param to group related files: e.g. key `note:gpt4-findings` with folder `lit-review` creates `notes/lit-review/gpt4-findings.md`.",
    "Never use bare keys without a prefix — they end up in `artifacts/` which is not user-facing.",
    "",
    `## Workspace\nRoot: ${process.cwd()}`,
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
  mode?: "planning" | "full";
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
}): Promise<AgentTurnResult> {
  const requestedSkills = await parseRequestedSkills(input.message, input.homeDir);
  const activeSkills = [...(input.activeSkills ?? []), ...requestedSkills].filter(
    (skill, index, array) => array.findIndex((item) => item.id === skill.id) === index
  );

  const isPlanning = input.mode === "planning";
  const tools = isPlanning ? getToolsForMode("planning") : TOOL_SCHEMAS;
  const systemPrompt = isPlanning
    ? buildPlanningSystemPrompt(input.workspace, activeSkills)
    : buildSystemPrompt(input.workspace, activeSkills);

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
  const taskBlock = getTaskContextBlock();

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

      let detectedCharter: string | undefined;
      if (isPlanning) {
        const charterMatch = fullText.match(/```research-charter\n([\s\S]*?)```/);
        if (charterMatch?.[1]) {
          detectedCharter = charterMatch[1].trim();
        }
      }

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
        detectedCharter,
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
      input.onToolActivity?.({
        type: "tool_start",
        toolCallId: toolCall.id,
        name: toolCall.name,
        description,
      });

      const startTime = Date.now();
      try {
        const result = await executeTool(
          toolCall.name,
          args,
          input.workspace,
          activeSkills,
          input.homeDir,
          signal,
          input.provider,
          input.onSubAgentProgress,
          toolCall.id
        );
        const durationMs = Date.now() - startTime;
        input.onToolActivity?.({
          type: "tool_end",
          toolCallId: toolCall.id,
          name: toolCall.name,
          description,
          durationMs,
        });
        return { toolCall, result, description, durationMs };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        input.onToolActivity?.({
          type: "tool_end",
          toolCallId: toolCall.id,
          name: toolCall.name,
          description,
          durationMs,
        });
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
