import type { ProposedUpdate, WorkspaceContext } from "../state";

interface StringEdit {
  old_str: string;
  new_str: string;
  replace_all?: boolean;
}

type UpdateArgs =
  | { key: string; summary: string; mode?: "rewrite"; content: string }
  | { key: string; summary: string; mode: "targeted"; edits: StringEdit[] };

/**
 * Propose an edit to an existing workspace file.
 * Does NOT apply the edit — emits a proposed_update event for user review.
 *
 * Supports two modes:
 * - "rewrite" (default): replaces entire file content
 * - "targeted": applies surgical string-match edits (old_str → new_str)
 */
export function executeUpdateExistingFile(
  args: UpdateArgs,
  ctx: WorkspaceContext
): { result: string; update: ProposedUpdate } | { result: string; update: null } {
  if (!(args.key in ctx.workspaceFiles)) {
    return {
      result: `Error: File "${args.key}" does not exist in the workspace. Available keys: ${ctx.availableKeys.join(", ")}`,
      update: null,
    };
  }

  const mode = args.mode ?? "rewrite";

  if (mode === "rewrite") {
    const content = (args as { content: string }).content;
    if (content == null) {
      return {
        result: `Error: "content" is required for rewrite mode.`,
        update: null,
      };
    }

    const update: ProposedUpdate = {
      id: crypto.randomUUID(),
      type: "edit",
      key: args.key,
      content,
      summary: args.summary,
    };

    return {
      result: `Proposed edit to "${args.key}": ${args.summary}. The user will review and accept or reject this change.`,
      update,
    };
  }

  // targeted mode — string-match edits
  const edits = (args as { edits: StringEdit[] }).edits;
  if (!edits || !Array.isArray(edits) || edits.length === 0) {
    return {
      result: `Error: "edits" array is required and must be non-empty for targeted mode.`,
      update: null,
    };
  }

  let currentContent = ctx.workspaceFiles[args.key];
  const editDescriptions: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    if (edit.old_str == null || edit.new_str == null) {
      return {
        result: `Error: Edit ${i + 1} is missing required "old_str" or "new_str" field.`,
        update: null,
      };
    }

    if (edit.old_str === edit.new_str) {
      return {
        result: `Error: Edit ${i + 1} has identical old_str and new_str — nothing to change.`,
        update: null,
      };
    }

    const occurrences = countOccurrences(currentContent, edit.old_str);

    if (occurrences === 0) {
      // Provide a helpful snippet of the file for context
      const preview = currentContent.length > 200
        ? currentContent.slice(0, 200) + "..."
        : currentContent;
      return {
        result: `Error: Edit ${i + 1} old_str not found in file "${args.key}". The content may have changed, or your match string is incorrect. Read the file first with read_workspace_files to get the current content.\n\nFile preview:\n${preview}`,
        update: null,
      };
    }

    if (occurrences > 1 && !edit.replace_all) {
      return {
        result: `Error: Edit ${i + 1} old_str matches ${occurrences} locations in "${args.key}". Provide more surrounding context to make it unique, or set replace_all: true to replace all occurrences.`,
        update: null,
      };
    }

    if (edit.replace_all) {
      currentContent = currentContent.split(edit.old_str).join(edit.new_str);
      editDescriptions.push(`replaced all ${occurrences} occurrences`);
    } else {
      currentContent = currentContent.replace(edit.old_str, edit.new_str);
      editDescriptions.push(
        `"${truncate(edit.old_str, 30)}" → "${truncate(edit.new_str, 30)}"`
      );
    }
  }

  const autoSummary = `${args.summary} [${edits.length} edit(s): ${editDescriptions.join("; ")}]`;

  const update: ProposedUpdate = {
    id: crypto.randomUUID(),
    type: "edit",
    key: args.key,
    content: currentContent,
    summary: autoSummary,
  };

  return {
    result: `Proposed targeted edits to "${args.key}": ${autoSummary}. The user will review and accept or reject this change.`,
    update,
  };
}

/** Count non-overlapping occurrences of a substring */
function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/** Truncate a string for display in edit descriptions */
function truncate(str: string, max: number): string {
  const oneLine = str.replace(/\n/g, "\\n");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}
