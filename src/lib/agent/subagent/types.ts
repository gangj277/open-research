import type { ToolDefinition } from "../tools";
import type { ReasoningEffort } from "@/lib/llm/types";
import type { SubAgentHandoff } from "../tools/finish-subagent";

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
  /** System prompt builder — receives workspace root, and optionally a skill prompt */
  buildSystemPrompt: (workspaceRoot: string, skillPrompt?: string) => string;
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
  /** Last 3 completed tool descriptions for live progress display */
  recentTools?: string[];
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
  /** Structured handoff report from finish_subagent (if called) */
  handoff?: SubAgentHandoff;
}
