import type { DiscoveredSource } from "@/lib/discovery/scholarly-search";
import type { AddedSource, ProposedUpdate } from "../state";

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
}
