import type { ToolDefinition } from "../tools";
import type { ReasoningEffort } from "@/lib/llm/types";

// ── Sub-Agent Type Configuration ───────────────────────────────────────────

export interface SubAgentConfig {
  /** Unique type identifier */
  id: string;
  /** Human-readable name for logging/display */
  name: string;
  /** Model to use. If undefined, resolved from provider catalog (backgroundModel). */
  model?: string;
  /** Reasoning effort level */
  reasoningEffort: ReasoningEffort;
  /** Which tools this agent type can access (by name) */
  allowedTools: Set<string>;
  /** System prompt builder — receives workspace root for context */
  buildSystemPrompt: (workspaceRoot: string) => string;
  /** Max tool-call iterations before forced termination (safety) */
  maxIterations: number;
}

// ── Sub-Agent Progress Events ──────────────────────────────────────────────

export interface SubAgentProgress {
  /** Stable parent tool-call identifier */
  agentId: string;
  agentType: string;
  goal: string;
  /** Current tool being executed (empty when thinking) */
  currentTool: string;
  /** Total completed tool calls so far */
  toolCount: number;
  /** "running" while active, "done" when finished */
  status: "running" | "done";
}

// ── Sub-Agent Result ───────────────────────────────────────────────────────

export interface SubAgentResult {
  /** The final text response from the sub-agent */
  summary: string;
  /** Number of tool calls made during execution */
  toolCallCount: number;
  /** Total execution time in ms */
  durationMs: number;
  /** Whether it hit the iteration limit */
  hitLimit: boolean;
}
