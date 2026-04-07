import type { LLMMessage } from "@/lib/llm/types";
import type { LLMProvider } from "@/lib/llm/provider";
import { selectModelForTask } from "@/lib/llm/provider-catalog";

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
  "gpt-5.4-mini": 128_000,
  "o3": 200_000,
  "o4-mini": 200_000,
  "gemini-3.1-pro-preview": 1_048_576,
  "gemini-3-flash-preview": 1_048_576,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const AUTO_COMPACT_TOKEN_LIMIT = 250_000; // Fixed trigger at 250K tokens

export function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

export function getCompactThreshold(model: string): number {
  // For models with context > 250K, trigger at 250K
  // For smaller models, trigger at 80% of their context window
  const window = getContextWindow(model);
  return window > AUTO_COMPACT_TOKEN_LIMIT
    ? AUTO_COMPACT_TOKEN_LIMIT
    : Math.floor(window * 0.80);
}

export function getEffectiveLimit(model: string): number {
  return Math.floor(getContextWindow(model) * EFFECTIVE_PERCENT);
}

// ── Token Usage Tracking ────────────────────────────────────────────────────

export interface TokenBreakdown {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
  total: number;
}

export interface SessionTokenUsage {
  /** Cumulative tokens across all turns */
  cumulative: TokenBreakdown;
  /** Last turn's tokens (for context window calculation) */
  lastTurn: TokenBreakdown;
  /** Estimated current context window usage */
  estimatedCurrentTokens: number;
  /** Number of compactions performed */
  compactionCount: number;

  // Legacy compat — these map to cumulative fields
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastTurnTokens: number;
}

function emptyBreakdown(): TokenBreakdown {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 };
}

export function createSessionUsage(): SessionTokenUsage {
  return {
    cumulative: emptyBreakdown(),
    lastTurn: emptyBreakdown(),
    estimatedCurrentTokens: 0,
    compactionCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastTurnTokens: 0,
  };
}

export function updateUsageFromApi(
  usage: SessionTokenUsage,
  apiUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  }
): void {
  const cached = apiUsage.cachedTokens ?? 0;
  const reasoning = apiUsage.reasoningTokens ?? 0;
  // Adjusted input = total input - cached (to isolate non-cached input, like OpenCode)
  const adjustedInput = Math.max(0, apiUsage.promptTokens - cached);
  // Adjusted output = total output - reasoning (to separate text output from thinking)
  const adjustedOutput = Math.max(0, apiUsage.completionTokens - reasoning);

  // Update cumulative
  usage.cumulative.input += adjustedInput;
  usage.cumulative.output += adjustedOutput;
  usage.cumulative.reasoning += reasoning;
  usage.cumulative.cache.read += cached;
  usage.cumulative.total += apiUsage.totalTokens;

  // Update last turn (overwrite — latest step is most accurate)
  usage.lastTurn = {
    input: adjustedInput,
    output: adjustedOutput,
    reasoning,
    cache: { read: cached, write: 0 },
    total: apiUsage.totalTokens,
  };

  // Legacy compat
  usage.inputTokens = usage.cumulative.input;
  usage.outputTokens = usage.cumulative.output;
  usage.totalTokens = usage.cumulative.total;
  usage.lastTurnTokens = apiUsage.totalTokens;
}

// ── Phase 1: Prune Tool Outputs ─────────────────────────────────────────────
// Modeled after OpenCode's prune step:
// - Walk backwards from newest messages
// - Protect the last 40K tokens of tool outputs
// - Skip the 2 most recent user turns entirely
// - Only prune if savings exceed 20K tokens

const PRUNE_PROTECT_TOKENS = 40_000;
const PRUNE_MIN_SAVINGS = 20_000;
const PRUNE_SKIP_RECENT_USER_TURNS = 2;

export function pruneToolOutputs(messages: LLMMessage[]): { messages: LLMMessage[]; savedTokens: number } {
  // Find indices of user messages (to skip recent turns)
  const userIndices: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") userIndices.push(i);
  }

  // The boundary: don't touch anything at or after the Nth most recent user message
  const protectBoundary = userIndices.length >= PRUNE_SKIP_RECENT_USER_TURNS
    ? userIndices[PRUNE_SKIP_RECENT_USER_TURNS - 1]
    : 0;

  // Find all tool messages that are candidates for pruning (before the boundary)
  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool" && i < protectBoundary) {
      toolIndices.push(i);
    }
  }

  if (toolIndices.length === 0) return { messages, savedTokens: 0 };

  // Walk backwards from the newest pruneable tool output, protect last PRUNE_PROTECT_TOKENS
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

  // Replace old tool outputs with a stub
  let savedTokens = 0;
  const result = [...messages];
  for (let i = 0; i < cutoffIdx; i++) {
    const idx = toolIndices[i];
    const msg = result[idx];
    const oldTokens = estimateMessageTokens(msg);
    const stub = "[output pruned — use read_file to re-read if needed]";
    savedTokens += oldTokens - estimateTokens(stub);
    result[idx] = { ...msg, content: stub };
  }

  if (savedTokens < PRUNE_MIN_SAVINGS) {
    return { messages, savedTokens: 0 };
  }

  return { messages: result, savedTokens };
}

// ── Phase 2: Summarize Conversation ─────────────────────────────────────────
// Structured template from OpenCode + Claude Code patterns:
// Goal / Instructions / Discoveries / Accomplished / Relevant Files / Next Steps

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer for a research agent. Your job is to create a handoff summary that another agent instance can use to seamlessly continue the work.

Do not respond to any questions in the conversation. Only output the summary.
Respond in the same language the user used.`;

const COMPACTION_USER_TEMPLATE = `Provide a detailed summary of our conversation above for handoff to another agent that will continue the work.

Stick to this template:

## Goal
[What is the user trying to accomplish? Be specific.]

## Instructions
- [Important instructions or preferences the user gave]
- [Research methodology constraints or requirements]
- [If there is a research charter or plan, summarize its key points]

## Discoveries
- [Key findings from paper searches, data analysis, or experiments]
- [Important facts, numbers, or evidence discovered]
- [Any surprising or contradicting results]

## Accomplished
- [What work has been completed]
- [What is currently in progress]
- [What remains to be done]

## Relevant Files
[List workspace files that were read, created, or modified. Include what each contains.]
- path/to/file.md — description of contents
- experiments/script.py — what it does and its results

## Active Context
- [Current research question or hypothesis being investigated]
- [Which skills are active]
- [Any pending user decisions or questions]

## Next Steps
1. [Most immediate next action]
2. [Following action]
3. [And so on]

{CUSTOM_INSTRUCTIONS}`;

/**
 * Phase 2: Summarize the conversation into a structured handoff.
 * Preserves the system prompt and produces a single summary message.
 */
export async function compactConversation(
  messages: LLMMessage[],
  provider: LLMProvider,
  model: string,
  customInstructions?: string,
  signal?: AbortSignal
): Promise<LLMMessage[]> {
  const systemMsg = messages.find((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");

  // Build conversation text — include role labels, truncate very long tool outputs
  const conversationText = conversationMsgs
    .map((m) => {
      const role = m.role === "assistant" ? "Agent" : m.role === "user" ? "User" : "Tool";
      let content: string;
      if (typeof m.content === "string") {
        // Truncate individual messages to 3K chars for the summary prompt
        content = m.content.length > 3000 ? m.content.slice(0, 3000) + "\n[... truncated]" : m.content;
      } else if (m.content) {
        content = JSON.stringify(m.content).slice(0, 1000);
      } else if (m.tool_calls?.length) {
        content = m.tool_calls.map((tc) => `[tool: ${tc.function.name}]`).join(", ");
      } else {
        content = "[empty]";
      }
      return `[${role}]: ${content}`;
    })
    .join("\n\n");

  // Build the summarization prompt
  const customBlock = customInstructions
    ? `\n\nAdditional instructions: ${customInstructions}`
    : "";
  const userPrompt = COMPACTION_USER_TEMPLATE.replace("{CUSTOM_INSTRUCTIONS}", customBlock);

  // Use a smaller/cheaper model for compaction if available
  const compactionModel = selectModelForTask(provider.kind, model, "compaction");

  const summaryResponse = await provider.callLLM({
    messages: [
      { role: "system", content: COMPACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here is the conversation to summarize:\n\n${conversationText.slice(0, 120_000)}\n\n---\n\n${userPrompt}`,
      },
    ],
    model: compactionModel,
    maxTokens: 4096,
  });

  // Build compacted message array
  const compacted: LLMMessage[] = [];
  if (systemMsg) compacted.push(systemMsg);

  // The summary becomes a user message + assistant acknowledgment
  // This pattern ensures the model treats the summary as established context
  compacted.push({
    role: "user",
    content: "What have we accomplished so far in this research session?",
  });
  compacted.push({
    role: "assistant",
    content: summaryResponse.content,
  });

  return compacted;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Check if compaction is needed and perform it (auto-compact).
 * Two-phase: prune old tool outputs first, then summarize if still over threshold.
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
  const compacted = await compactConversation(pruned, provider, model, undefined, signal);
  usage.estimatedCurrentTokens = estimateConversationTokens(compacted);
  usage.compactionCount++;

  return { messages: compacted, didCompact: true };
}

/**
 * Manual compaction — triggered by /compact command.
 * Supports custom instructions like "/compact keep the statistical findings".
 */
export async function manualCompact(
  messages: LLMMessage[],
  model: string,
  provider: LLMProvider,
  usage: SessionTokenUsage,
  customInstructions?: string,
  signal?: AbortSignal
): Promise<{ messages: LLMMessage[]; didCompact: boolean }> {
  if (messages.length <= 2) {
    return { messages, didCompact: false };
  }

  // Always prune first
  const { messages: pruned } = pruneToolOutputs(messages);

  // Then summarize with custom instructions
  const compacted = await compactConversation(pruned, provider, model, customInstructions, signal);
  usage.estimatedCurrentTokens = estimateConversationTokens(compacted);
  usage.compactionCount++;

  return { messages: compacted, didCompact: true };
}
