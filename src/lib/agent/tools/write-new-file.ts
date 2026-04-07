import type { ProposedUpdate, WorkspaceContext } from "../state";

/**
 * Propose a new file for the workspace.
 * Does NOT create the file — emits a proposed_update event for user review.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizeDbBackedKey(key: string): string {
  const match = key.match(/^(note|paper|experiment):(.+)$/);
  if (!match) {
    return key;
  }

  const [, prefix, suffix] = match;
  if (isUuid(suffix)) {
    return key;
  }

  return `${prefix}:${crypto.randomUUID()}`;
}

const VALID_PREFIXES = ["note:", "paper:", "experiment:", "source:", "path:"];

export function executeWriteNewFile(
  args: { key: string; label: string; content: string; folder?: string },
  ctx: WorkspaceContext
): { result: string; update: ProposedUpdate } | { result: string; update: null } {
  const normalizedKey = normalizeDbBackedKey(args.key);

  if (!VALID_PREFIXES.some((p) => normalizedKey.startsWith(p))) {
    return {
      result: `Error: Key "${normalizedKey}" is missing a required prefix. Use one of: note:<slug>, paper:<slug>, experiment:<slug>, source:<slug>, or path:<relative/path>. Example: note:${normalizedKey}`,
      update: null,
    };
  }

  if (normalizedKey in ctx.workspaceFiles) {
    return {
      result: `Error: File "${normalizedKey}" already exists. Use update_existing_file to modify it.`,
      update: null,
    };
  }

  const update: ProposedUpdate = {
    id: crypto.randomUUID(),
    type: "new",
    key: normalizedKey,
    label: args.label,
    ...(args.folder ? { folder: args.folder } : {}),
    content: args.content,
    summary: `New file: ${args.label}`,
  };

  return {
    result: `Proposed new file "${args.label}" (key: "${normalizedKey}")${args.folder ? ` in folder "${args.folder}"` : ""}. The user will review and accept or reject.`,
    update,
  };
}
