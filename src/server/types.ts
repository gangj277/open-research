import type {
  ProposedUpdate,
  AskUserQuestion,
  AskUserAnswer,
  CompactionSnapshot,
  TokenUsage,
  AgentMode,
} from "@/lib/agent/state";
import type { DiscoveredSource } from "@/lib/discovery/scholarly-search";
import type { AddedSource } from "@/lib/agent/state";
import type { ToolActivity, AgentTurnResult } from "@/lib/agent/runtime";
import type { SubAgentProgress } from "@/lib/agent/subagent";
import type { SessionTokenUsage } from "@/lib/agent/context-manager";
import type { SnapshotPatch } from "@/lib/snapshot/types";
import type { LLMMessage } from "@/lib/llm/types";
import type { RuntimeSkill } from "@/lib/skills/runtime";

// ── Server Event Protocol ──────────────────────────────────────────────────
// Extends the existing SSEEvent type with additional events for streaming callbacks
// that previously lived as direct function callbacks on runAgentTurn.

export type ServerEvent =
  // ── Text streaming ──
  | { type: "text_delta"; content: string }
  // ── Tool execution ──
  | { type: "tool_activity"; activity: ToolActivity }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: string }
  // ── Sub-agent ──
  | { type: "subagent_progress"; progress: SubAgentProgress }
  // ── Proposed updates ──
  | { type: "proposed_update"; update: ProposedUpdate }
  | { type: "update_resolved"; updateId: string; action: "accepted" | "rejected" }
  // ── Search results ──
  | { type: "search_results"; results: DiscoveredSource[] }
  | { type: "sources_added"; sources: AddedSource[] }
  // ── Skills ──
  | { type: "skill_activated"; skills: string[] }
  // ── Context compaction ──
  | {
      type: "context_compacted";
      scope: "history" | "turn";
      estimatedTokensBefore: number;
      estimatedTokensAfter: number;
      snapshot?: CompactionSnapshot;
    }
  // ── Ask user (bidirectional) ──
  | { type: "ask_user"; question: AskUserQuestion }
  | { type: "question_resolved"; questionId: string }
  // ── Token usage ──
  | { type: "token_update"; usage: SessionTokenUsage }
  // ── Background operations ──
  | { type: "memory_extracted"; memories: string[] }
  | { type: "agents_md_updated" }
  | { type: "ontology_updated" }
  // ── Snapshots ──
  | { type: "snapshot_taken"; turnIndex: number; hash: string; patch: SnapshotPatch }
  | { type: "snapshot_reverted"; revertedTurns: number[]; filesRestored: string[] }
  // ── Turn lifecycle ──
  | { type: "error"; message: string }
  | { type: "done"; usage?: TokenUsage };

// ── Bridge Interfaces ──────────────────────────────────────────────────────
// These replace module-level shared mutable state with injectable interfaces.

export interface QuestionBridge {
  createQuestion(question: AskUserQuestion): Promise<AskUserAnswer>;
}

// ── Server Client Interface ────────────────────────────────────────────────
// The contract between the TUI and the server. Has two implementations:
// - DirectClient (in-process, calls app.request())
// - HttpClient (real HTTP, for remote access)

export interface SendMessageOptions {
  model?: string;
  reasoningEffort?: string;
  activeSkills?: RuntimeSkill[];
  agentMode?: AgentMode;
}

export interface ServerClient {
  // ── Session ──
  createSession(workspaceDir: string): Promise<{ id: string }>;
  listSessions(workspaceDir: string): Promise<Array<{ id: string; startedAt: string; lastActivity: string; preview: string; turnCount: number }>>;
  getSessionHistory(sessionId: string): Promise<{ messages: Array<{ role: string; text: string }>; llmHistory: LLMMessage[] }>;
  deleteSession(sessionId: string): Promise<void>;

  // ── Prompting ──
  sendMessage(sessionId: string, message: string, options?: SendMessageOptions): AsyncIterable<ServerEvent>;
  abort(sessionId: string): Promise<void>;
  compact(sessionId: string): Promise<void>;

  // ── Questions ──
  answerQuestion(sessionId: string, questionId: string, answer: AskUserAnswer): Promise<void>;

  // ── Proposed Updates ──
  getPendingUpdates(sessionId: string): Promise<ProposedUpdate[]>;
  acceptUpdate(sessionId: string, updateId: string): Promise<void>;
  rejectUpdate(sessionId: string, updateId: string): Promise<void>;

  // ── Snapshots ──
  getSnapshots(sessionId: string): Promise<Array<{ turnIndex: number; patch: SnapshotPatch; timestamp: string }>>;
  revert(sessionId: string, afterTurn: number): Promise<{ revertedTurns: number[]; filesRestored: string[] }>;
  unrevert(sessionId: string): Promise<void>;

  // ── Workspace ──
  initWorkspace(workspaceDir: string): Promise<void>;
  scanWorkspace(workspaceDir: string): Promise<Array<{ key: string; label: string }>>;

  // ── Auth ──
  getAuthStatus(): Promise<{ status: "missing" | "connected"; provider?: string }>;
  login(): Promise<void>;
  loginGemini(): Promise<void>;
  importCodex(): Promise<void>;
  logout(): Promise<void>;

  // ── Config ──
  getConfig(): Promise<Record<string, unknown>>;
  updateConfig(updates: Record<string, unknown>): Promise<void>;
  getModels(): Promise<Array<{ id: string; name: string; contextWindow: number }>>;

  // ── Skills ──
  listSkills(): Promise<Array<{ name: string; description: string }>>;

  // ── Memory ──
  listMemories(): Promise<Array<{ id: string; content: string; category: string; scope: string }>>;
  deleteMemory(id: string): Promise<void>;
  clearMemories(): Promise<void>;

  // ── Ontology ──
  getOntologyStatus(): Promise<{ noteCount: number; edgeCount: number }>;
}
