import type { LLMMessage } from "@/lib/llm/types";
import type { LLMProvider } from "@/lib/llm/provider";
import { TOOL_SCHEMAS, getToolsForMode } from "./tool-schemas";
import type { ProposedUpdate, WorkspaceContext } from "./state";
import { buildPlanningSystemPrompt } from "./prompts/planning";
import { executeTool } from "./tool-dispatcher";
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

// ── Tool Activity Event ─────────────────────────────────────────────────────

export interface ToolActivity {
  type: "tool_start" | "tool_end";
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
  search_external_sources: () => "Searching academic papers",
  ask_user: (a) => `Asking: ${(a.question as string)?.slice(0, 50) ?? "question"}`,
  load_skill: (a) => `Loading skill: ${a.skill_id ?? ""}`,
  read_skill_reference: (a) => `Reading skill reference: ${a.path ?? ""}`,
  create_paper: (a) => `Creating paper: ${a.title ?? ""}`,
};

function describeToolCall(name: string, args: Record<string, unknown>): string {
  const fn = TOOL_DESCRIPTIONS[name];
  return fn ? fn(args) : `Running ${name}`;
}

// ── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: WorkspaceContext, activeSkills: RuntimeSkill[]): string {
  const skillText = activeSkills
    .map((skill) => `## Active Skill: ${skill.name}\n${skill.prompt}`)
    .join("\n\n");
  return [
    "You are Open Research, a local-first research agent running inside a terminal CLI.",
    "",
    "## Capabilities",
    "You have full access to the local filesystem and shell. You can:",
    "- Read any file on disk with read_file",
    "- List directories with list_directory to explore the workspace and discover files",
    "- Search file contents with search_workspace",
    "- Run shell commands with run_command (python, R, node, LaTeX, curl, git, etc.)",
    "- Write new workspace files or edit existing ones",
    "- Search academic papers across OpenAlex, Semantic Scholar, and arXiv",
    "- Fetch web pages and API responses with fetch_url",
    "- Ask the user questions when you need clarification with ask_user",
    "- Activate research skills for specialized workflows",
    "",
    "## Principles",
    "- Start by exploring. Use list_directory and search_workspace to understand the workspace before acting.",
    "- Read before writing. Understand existing files before making changes.",
    "- Ground claims in sources. Cite papers and data, not assumptions.",
    "- Run code to verify. When you write a script, run it and check the output.",
    "- Be transparent. Show the user what you're doing and why.",
    "- When unsure, ask. Use ask_user rather than guessing.",
    "- For large outputs, redirect to a file and read selectively.",
    "- Always wrap file paths in backticks: `notes/brief.md`, `experiments/analysis.py`. Include line references as `src/file.ts:42`. This makes them clickable.",
    "",
    `## Workspace\nRoot: ${process.cwd()}\nUse list_directory to explore. Use search_workspace or read_file to read content.`,
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

  const model = input.model ?? "gpt-5.4";
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

  const fullSystemPrompt = [
    systemPrompt,
    memoryBlock || null,
    agentsMd ? `## Project Context (from AGENTS.md)\n${agentsMd}` : null,
  ].filter(Boolean).join("\n\n");

  let messages: LLMMessage[] = [
    { role: "system", content: fullSystemPrompt },
    ...input.history,
    { role: "user", content: input.message },
  ];

  const proposedUpdates: ProposedUpdate[] = [];
  const searchResults: AgentTurnResult["searchResults"] = [];
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
      reasoningEffort: "medium",
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
        model: "gpt-5.4-mini",
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
          model: "gpt-5.4-mini",
        }).then((updated) => {
          if (updated) input.onAgentsMdUpdated?.();
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

    for (const toolCall of toolCalls) {
      if (signal?.aborted) break;

      const args = JSON.parse(toolCall.arguments || "{}");
      const description = describeToolCall(toolCall.name, args);

      // Notify TUI: tool starting
      input.onToolActivity?.({
        type: "tool_start",
        name: toolCall.name,
        description,
      });

      const startTime = Date.now();
      const result = await executeTool(
        toolCall.name,
        args,
        input.workspace,
        activeSkills,
        input.homeDir,
        signal
      );
      const durationMs = Date.now() - startTime;

      // Notify TUI: tool finished
      input.onToolActivity?.({
        type: "tool_end",
        name: toolCall.name,
        description,
        durationMs,
      });

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
