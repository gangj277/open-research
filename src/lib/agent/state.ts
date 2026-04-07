import type { DiscoveredSource } from "@/lib/discovery/scholarly-search";
import type { PaperQualityMeta } from "@/lib/discovery/paper-quality";
import type { SearchFilterConfig } from "@/lib/discovery/search-filters";
import type { LLMMessage } from "@/lib/llm/types";

// ── Proposed Update (file edit / new file) ──

export interface ProposedUpdate {
  id: string;
  type: "edit" | "new";
  key: string;
  label?: string;
  folder?: string;
  content: string;
  summary: string;
  /** Original file content before the edit (only present for type "edit") */
  oldContent?: string;
}

// ── Ask User (pause-and-resume questions) ──

export interface AskUserOption {
  label: string;
  description: string;
}

export interface AskUserQuestion {
  id: string;
  question: string;
  options: AskUserOption[];
  allowCustom?: boolean;
}

export interface AskUserAnswer {
  questionId: string;
  answer: string;
  isCustom: boolean;
}

// ── Task Decomposition ──

export type TaskMode = "inline" | "isolated";
export type TaskStatus = "pending" | "active" | "completed";

export interface TaskDefinition {
  id: string;
  objective: string;
  context_keys?: string[];
  depends_on?: string[];
  mode?: TaskMode;
}

export interface TaskState extends TaskDefinition {
  status: TaskStatus;
  result?: string;
}

export interface TaskPlan {
  tasks: TaskState[];
  activeTaskId?: string;
  created: number;
}

// ── Agent Modes ──

export type AgentMode = "manual-review" | "auto-approve" | "auto-research";

export type PlanningPhaseStatus = "idle" | "planning" | "charter-review";

export interface ResearchCharter {
  id: string;
  researchQuestion: string;
  successCriteria: string[];
  scopeBoundaries: string[];
  knownStartingPoints: string[];
  proposedSteps: string[];
  rawMarkdown: string;
  createdAt: string;
}

export interface PlanningState {
  status: PlanningPhaseStatus;
  charter?: ResearchCharter;
  planningHistory: LLMMessage[];
}

// ── Context Compaction ──

export interface CompactionSnapshot {
  version: 1;
  compactedMessageCount: number;
  summary: string;
  keyFacts: string[];
  openLoops: string[];
  nextStepHint?: string;
  activatedSkills: string[];
  taskPlan?: TaskPlan;
  estimatedTokensAfter: number;
  compactedAt: string;
}

export interface AgentContinuationState {
  activeSkills: string[];
  taskPlan?: TaskPlan;
  compactionSnapshot?: CompactionSnapshot;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ── Agent Messages ──

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolResult {
  name: string;
  result: string;
}

// ── Agent Turn Context ──

/** Lightweight metadata per file — used by constitution to build structured file map */
export interface FileMeta {
  group: "core" | "source" | "paper" | "note" | "experiment" | "workspace";
  origin?: "uploaded" | "discovered";
  folder?: string;
}

export interface WorkspaceToolSearchArgs {
  queries: string[];
  context_lines?: number;
  file_keys?: string[];
  max_results?: number;
}

export interface WorkspaceContext {
  /** Absolute path to the workspace root directory */
  workspaceDir?: string;
  /** Run ID — needed for persisting agent-discovered sources */
  runId?: string;
  /** All workspace file keys → content (artifacts + edited overlays) */
  workspaceFiles: Record<string, string>;
  /** Which file the user currently has open */
  activeFileKey?: string;
  /** File keys available in workspace */
  availableKeys: string[];
  /** Explicit folder paths available in the workspace, including empty UI folders */
  folderPaths?: string[];
  /** Human-readable labels for each key (e.g. source:abc → "Neural Networks in Climate") */
  fileLabels?: Record<string, string>;
  /** Per-file metadata for structured grouping in system prompt */
  fileMeta?: Record<string, FileMeta>;
  /** User-configured search filters for source discovery */
  searchFilters?: SearchFilterConfig;
  /** Optional async file loader for keys not eagerly materialized in workspaceFiles */
  readWorkspaceFileByKey?: (key: string) => Promise<string | null>;
  /** Optional async search backend for large or on-disk workspace content */
  searchWorkspace?: (args: WorkspaceToolSearchArgs) => Promise<string>;
}

// ── Added Source (agent-discovered, persisted to workspace) ──

export interface AddedSource {
  sourceId: string;
  key: string;                // "source:<uuid>"
  label: string;
  content: string;            // summary markdown
  sourceUrl?: string;
  paperQuality?: PaperQualityMeta;
  folder?: string;
}

// ── SSE Event Types ──

export type SSEEvent =
  | { type: "text_delta"; content: string }
  | { type: "activity"; activity: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: string }
  | { type: "proposed_update"; update: ProposedUpdate }
  | { type: "search_results"; results: DiscoveredSource[] }
  | { type: "sources_added"; sources: AddedSource[] }
  | { type: "skill_activated"; skills: string[] }
  | {
      type: "context_compacted";
      scope: "history" | "turn";
      estimatedTokensBefore: number;
      estimatedTokensAfter: number;
      snapshot?: CompactionSnapshot;
    }
  | { type: "ask_user"; question: AskUserQuestion }
  | { type: "task_plan"; tasks: TaskState[] }
  | { type: "task_update"; taskId: string; status: TaskStatus; result?: string }
  | { type: "error"; message: string }
  | { type: "done"; usage?: TokenUsage };

// ── Agent State (conversation within one turn) ──

export interface AgentState {
  messages: LLMMessage[];
  proposedUpdates: ProposedUpdate[];
  searchResults: DiscoveredSource[];
  activatedSkills: string[];
  compactionSnapshot?: CompactionSnapshot;
  totalTokens: number;
  iterations: number;
  taskPlan?: TaskPlan;
}
