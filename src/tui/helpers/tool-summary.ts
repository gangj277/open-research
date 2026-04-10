// ── Tool Activity Grouping ──────────────────────────────────────────────────

const TOOL_GROUPS: Record<string, string> = {
  read_file: "read",
  read_pdf: "read",
  list_directory: "listed",
  search_workspace: "searched",
  search_external_sources: "searched papers",
  run_command: "ran",
  write_new_file: "wrote",
  update_existing_file: "edited",
  fetch_url: "fetched",
  ask_user: "asked user",
  launch_subagent: "sub-agent",
  load_skill: "loaded skill",
  create_paper: "created paper",
  read_skill_reference: "read",
  set_current_task: "focus",
  web_search: "web searched",
};

export function buildToolSummary(tools: Array<{ name: string; description: string; durationMs?: number }>): string {
  const groups: Record<string, number> = {};
  let totalMs = 0;
  for (const t of tools) {
    const group = TOOL_GROUPS[t.name] ?? t.name;
    groups[group] = (groups[group] ?? 0) + 1;
    if (t.durationMs) totalMs += t.durationMs;
  }

  const parts: string[] = [];
  if (groups["read"]) parts.push(`Read ${groups["read"]} file${groups["read"] > 1 ? "s" : ""}`);
  if (groups["listed"]) parts.push(`Listed ${groups["listed"]} dir${groups["listed"] > 1 ? "s" : ""}`);
  if (groups["searched"]) parts.push(`Searched workspace${groups["searched"] > 1 ? ` (${groups["searched"]}×)` : ""}`);
  if (groups["searched papers"]) parts.push(`Searched papers${groups["searched papers"] > 1 ? ` (${groups["searched papers"]}×)` : ""}`);
  if (groups["ran"]) parts.push(`Ran ${groups["ran"]} command${groups["ran"] > 1 ? "s" : ""}`);
  if (groups["wrote"]) parts.push(`Wrote ${groups["wrote"]} file${groups["wrote"] > 1 ? "s" : ""}`);
  if (groups["edited"]) parts.push(`Edited ${groups["edited"]} file${groups["edited"] > 1 ? "s" : ""}`);
  if (groups["fetched"]) parts.push(`Fetched ${groups["fetched"]} URL${groups["fetched"] > 1 ? "s" : ""}`);
  if (groups["asked user"]) parts.push("Asked user");
  if (groups["loaded skill"]) parts.push("Loaded skill");
  if (groups["created paper"]) parts.push("Created paper");
  if (groups["sub-agent"]) parts.push(`Ran ${groups["sub-agent"]} sub-agent${groups["sub-agent"] > 1 ? "s" : ""}`);
  if (groups["focus"]) parts.push(`Set focus`);
  if (groups["web searched"]) parts.push(`Web searched${groups["web searched"] > 1 ? ` (${groups["web searched"]}×)` : ""}`);

  // Catch any unmatched
  for (const [group, count] of Object.entries(groups)) {
    if (!["read", "listed", "searched", "searched papers", "ran", "wrote", "edited", "fetched", "asked user", "loaded skill", "created paper", "sub-agent", "focus", "web searched"].includes(group)) {
      parts.push(`${group} (${count})`);
    }
  }

  const dur = totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)}s` : "";
  return parts.join(" · ") + dur;
}
