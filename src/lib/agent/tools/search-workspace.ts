import type { WorkspaceContext } from "../state";

interface SearchWorkspaceArgs {
  queries: string[];
  context_lines?: number;
  file_keys?: string[];
  max_results?: number;
}

interface Match {
  fileKey: string;
  fileLabel: string;
  lineNumber: number;
  matchedTerms: string[];
  contextLines: string[];
}

/**
 * Search across all workspace files for one or more terms (OR logic).
 * Returns matching lines with surrounding context and line numbers.
 */
export function executeSearchWorkspace(
  args: SearchWorkspaceArgs,
  ctx: WorkspaceContext
): string | Promise<string> {
  if (ctx.searchWorkspace) {
    return ctx.searchWorkspace(args);
  }

  const {
    queries,
    context_lines: contextRadius = 2,
    max_results: maxResults = 20,
  } = args;
  const filterKeys = args.file_keys;

  if (!queries || queries.length === 0) {
    return "Error: queries array must contain at least one search term.";
  }

  const normalizedQueries = queries.map((q) => q.toLowerCase());

  const keysToSearch =
    filterKeys?.length
      ? filterKeys.filter((k) => k in ctx.workspaceFiles)
      : ctx.availableKeys;

  const matches: Match[] = [];
  let totalMatches = 0;

  for (const key of keysToSearch) {
    const content = ctx.workspaceFiles[key];
    if (!content) continue;

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();

      // Find all query terms that match this line
      const hitTerms: string[] = [];
      for (let q = 0; q < normalizedQueries.length; q++) {
        if (lineLower.includes(normalizedQueries[q])) {
          hitTerms.push(queries[q]); // preserve original casing
        }
      }
      if (hitTerms.length === 0) continue;

      totalMatches++;
      if (matches.length >= maxResults) continue; // keep counting, stop collecting

      // Build context window
      const start = Math.max(0, i - contextRadius);
      const end = Math.min(lines.length - 1, i + contextRadius);
      const ctxLines: string[] = [];
      for (let j = start; j <= end; j++) {
        const marker = j === i ? ">" : " ";
        ctxLines.push(`${marker} ${j + 1}| ${lines[j]}`);
      }

      matches.push({
        fileKey: key,
        fileLabel: ctx.fileLabels?.[key] ?? key,
        lineNumber: i + 1,
        matchedTerms: hitTerms,
        contextLines: ctxLines,
      });
    }
  }

  if (matches.length === 0) {
    return `No matches found for: ${queries.map((q) => `"${q}"`).join(", ")}`;
  }

  // Group by file
  const byFile = new Map<string, Match[]>();
  for (const m of matches) {
    const arr = byFile.get(m.fileKey) ?? [];
    arr.push(m);
    byFile.set(m.fileKey, arr);
  }

  // Format output
  const out: string[] = [];
  const shown =
    matches.length < totalMatches
      ? `Showing ${matches.length} of ${totalMatches} matches`
      : `Found ${totalMatches} match${totalMatches === 1 ? "" : "es"}`;
  out.push(`${shown} across ${byFile.size} file${byFile.size === 1 ? "" : "s"}:\n`);

  for (const [fileKey, fileMatches] of Array.from(byFile.entries())) {
    const label = fileMatches[0].fileLabel;
    const tag = label !== fileKey ? `${fileKey} — "${label}"` : fileKey;
    out.push(
      `── ${tag} (${fileMatches.length} match${fileMatches.length === 1 ? "" : "es"}) ──`
    );

    for (const m of fileMatches) {
      out.push(`  [matched: ${m.matchedTerms.map((t) => `"${t}"`).join(", ")}]`);
      out.push(m.contextLines.join("\n"));
      out.push("");
    }
  }

  return out.join("\n");
}
