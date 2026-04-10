/**
 * Tool for sub-agents to signal completion with a structured handoff report.
 * The runner detects this tool call and stops the loop, capturing the handoff data.
 */

export interface SubAgentHandoff {
  summary: string;
  filesCreated: string[];
  filesModified: string[];
  keyFindings: string[];
  status: "completed" | "partial" | "blocked";
  blockedReason?: string;
}

/** Sentinel value returned by the tool so the runner can detect it */
export const FINISH_SUBAGENT_SENTINEL = "__FINISH_SUBAGENT__";

export function executeFinishSubagent(args: {
  summary: string;
  files_created?: string[];
  files_modified?: string[];
  key_findings?: string[];
  status?: string;
  blocked_reason?: string;
}): { result: string; handoff: SubAgentHandoff } {
  const handoff: SubAgentHandoff = {
    summary: args.summary || "Task completed.",
    filesCreated: args.files_created ?? [],
    filesModified: args.files_modified ?? [],
    keyFindings: args.key_findings ?? [],
    status: (args.status as SubAgentHandoff["status"]) || "completed",
    blockedReason: args.blocked_reason,
  };

  return {
    result: FINISH_SUBAGENT_SENTINEL,
    handoff,
  };
}
