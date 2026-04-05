import type { DiscoveredSource } from "@/lib/discovery/scholarly-search";
import type { AddedSource, ProposedUpdate, TaskPlan, TaskState } from "../state";

// ── OpenAI-format Tool Schemas ──

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ── Tool Dispatcher Result ──

export interface ToolExecutionResult {
  result: string;
  proposedUpdate?: ProposedUpdate;
  searchResults?: DiscoveredSource[];
  loadedSkillId?: string;
  addedSources?: AddedSource[];
  taskPlan?: TaskPlan;
  completedTaskId?: string;
  nextTask?: TaskState;
}
