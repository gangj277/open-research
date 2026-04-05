import type { LLMMessage } from "@/lib/llm/types";
import type { LLMProvider } from "@/lib/llm/provider";

// ── Token Estimation ────────────────────────────────────────────────────────

const BYTES_PER_TOKEN = 4;

/** Fast heuristic: ~4 bytes per token. Both Codex and OpenCode use this. */
export function estimateTokens(text: string): number {
  const bytes = Buffer.byteLength(text, "utf8");
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/** Estimate tokens for a full message (content + tool calls). */
export function estimateMessageTokens(msg: LLMMessage): number {
  let tokens = 4; // role + overhead per message
  if (typeof msg.content === "string") {
    tokens += estimateTokens(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if ("text" in part) tokens += estimateTokens(part.text);
    }
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += estimateTokens(tc.function.name) + estimateTokens(tc.function.arguments);
    }
  }
  return tokens;
}

/** Estimate total tokens for a message array. */
export function estimateConversationTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

// ── Model Context Windows ───────────────────────────────────────────────────

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.4": 272_000,
  "gpt-5.3-codex": 272_000,
  "gpt-5.2-codex": 272_000,
  "gpt-5.2": 272_000,
  "gpt-5.1-codex": 272_000,
  "gpt-5.1": 272_000,
  "gpt-5": 272_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "o3": 200_000,
  "o4-mini": 200_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const EFFECTIVE_PERCENT = 0.95;
const COMPACT_THRESHOLD_PERCENT = 0.90;

export function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

export function getCompactThreshold(model: string): number {
  return Math.floor(getContextWindow(model) * COMPACT_THRESHOLD_PERCENT);
}

export function getEffectiveLimit(model: string): number {
  return Math.floor(getContextWindow(model) * EFFECTIVE_PERCENT);
}

// ── Token Usage Tracking ────────────────────────────────────────────────────

export interface SessionTokenUsage {
  /** Cumulative input tokens across all turns (from API responses) */
  inputTokens: number;
  /** Cumulative output tokens across all turns */
  outputTokens: number;
  /** Cumulative total tokens */
  totalTokens: number;
  /** Last turn's usage */
  lastTurnTokens: number;
  /** Estimated current conversation tokens (local estimation) */
  estimatedCurrentTokens: number;
  /** Number of compactions performed */
  compactionCount: number;
}

export function createSessionUsage(): SessionTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastTurnTokens: 0,
    estimatedCurrentTokens: 0,
    compactionCount: 0,
  };
}

export function updateUsageFromApi(
  usage: SessionTokenUsage,
  apiUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
): void {
  usage.inputTokens += apiUsage.promptTokens;
  usage.outputTokens += apiUsage.completionTokens;
  usage.totalTokens += apiUsage.totalTokens;
  usage.lastTurnTokens = apiUsage.totalTokens;
}

// ── Context Compaction ──────────────────────────────────────────────────────

const PRUNE_PROTECT_TOKENS = 40_000; // Keep last 40K tokens of tool calls
const PRUNE_MIN_SAVINGS = 20_000;    // Only prune if saving > 20K tokens

/**
 * Phase 1: Prune old tool call outputs. Keeps the last PRUNE_PROTECT_TOKENS
 * worth of tool messages, replaces older ones with "[output pruned]".
 */
export function pruneToolOutputs(messages: LLMMessage[]): { messages: LLMMessage[]; savedTokens: number } {
  // Find all tool messages (newest last)
  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool") toolIndices.push(i);
  }

  if (toolIndices.length === 0) return { messages, savedTokens: 0 };

  // Calculate tokens from the end, find the cutoff
  let protectedTokens = 0;
  let cutoffIdx = toolIndices.length;
  for (let i = toolIndices.length - 1; i >= 0; i--) {
    const msg = messages[toolIndices[i]];
    const tokens = estimateMessageTokens(msg);
    if (protectedTokens + tokens > PRUNE_PROTECT_TOKENS) {
      cutoffIdx = i;
      break;
    }
    protectedTokens += tokens;
  }

  // Prune messages before cutoff
  let savedTokens = 0;
  const result = [...messages];
  for (let i = 0; i < cutoffIdx; i++) {
    const idx = toolIndices[i];
    const msg = result[idx];
    const oldTokens = estimateMessageTokens(msg);
    const pruned = "[output pruned — use read_file to re-read if needed]";
    savedTokens += oldTokens - estimateTokens(pruned);
    result[idx] = { ...msg, content: pruned };
  }

  if (savedTokens < PRUNE_MIN_SAVINGS) {
    return { messages, savedTokens: 0 }; // Not worth pruning
  }

  return { messages: result, savedTokens };
}

/**
 * Phase 2: Summarize the conversation into a compact handoff.
 * Replaces all messages (except system) with a summary.
 */
export async function compactConversation(
  messages: LLMMessage[],
  provider: LLMProvider,
  model: string,
  signal?: AbortSignal
): Promise<LLMMessage[]> {
  // Extract the system prompt (always keep it)
  const systemMsg = messages.find((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");

  // Build the conversation text for summarization
  const conversationText = conversationMsgs
    .map((m) => {
      const role = m.role === "assistant" ? "Agent" : m.role === "user" ? "User" : "Tool";
      const content = typeof m.content === "string"
        ? m.content
        : m.content
          ? JSON.stringify(m.content)
          : "[tool calls]";
      return `[${role}]: ${content?.slice(0, 2000)}`;
    })
    .join("\n\n");

  // Summarize using the LLM
  const summaryResponse = await provider.callLLM({
    messages: [
      {
        role: "system",
        content:
          "You are performing a CONTEXT COMPACTION. Summarize the conversation into a concise handoff document. Include:\n" +
          "1. **Goal**: What the user is trying to accomplish\n" +
          "2. **Key discoveries**: Important findings, file paths, data points\n" +
          "3. **Work completed**: What has been done so far\n" +
          "4. **Next steps**: What should happen next\n" +
          "5. **Active files**: Key file paths and their contents summary\n\n" +
          "Be concise but preserve all actionable information. This summary will replace the full conversation history.",
      },
      {
        role: "user",
        content: `Summarize this conversation:\n\n${conversationText.slice(0, 100_000)}`,
      },
    ],
    model,
    maxTokens: 4096,
  });

  // Build compacted message array
  const compacted: LLMMessage[] = [];
  if (systemMsg) compacted.push(systemMsg);
  compacted.push({
    role: "user",
    content:
      "[Context compacted — previous conversation summarized below]\n\n" +
      summaryResponse.content,
  });

  return compacted;
}

/**
 * Check if compaction is needed and perform it.
 * Returns the (possibly compacted) messages array.
 */
export async function maybeCompact(
  messages: LLMMessage[],
  model: string,
  provider: LLMProvider,
  usage: SessionTokenUsage,
  signal?: AbortSignal
): Promise<{ messages: LLMMessage[]; didCompact: boolean }> {
  const estimated = estimateConversationTokens(messages);
  usage.estimatedCurrentTokens = estimated;
  const threshold = getCompactThreshold(model);

  if (estimated < threshold) {
    return { messages, didCompact: false };
  }

  // Phase 1: Prune old tool outputs
  const { messages: pruned, savedTokens } = pruneToolOutputs(messages);
  const afterPrune = estimated - savedTokens;

  if (afterPrune < threshold) {
    usage.estimatedCurrentTokens = afterPrune;
    usage.compactionCount++;
    return { messages: pruned, didCompact: true };
  }

  // Phase 2: Full summarization
  const compacted = await compactConversation(pruned, provider, model, signal);
  usage.estimatedCurrentTokens = estimateConversationTokens(compacted);
  usage.compactionCount++;

  return { messages: compacted, didCompact: true };
}
