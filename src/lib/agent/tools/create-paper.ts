import type { ProposedUpdate, WorkspaceContext } from "../state";

/**
 * Create a new LaTeX paper in the workspace.
 * Generates a `paper:<uuid>` key and emits a proposed_update for user review.
 */
export function executeCreatePaper(
  args: { title: string; content: string },
  ctx: WorkspaceContext
): { result: string; update: ProposedUpdate } {
  const paperId = crypto.randomUUID();
  const key = `paper:${paperId}`;

  const update: ProposedUpdate = {
    id: crypto.randomUUID(),
    type: "new",
    key,
    label: args.title,
    content: args.content,
    summary: `New paper: ${args.title}`,
  };

  return {
    result: `Proposed new LaTeX paper "${args.title}" (key: "${key}"). The user will review and accept or reject.`,
    update,
  };
}
