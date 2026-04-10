import type { SubAgentConfig } from "./types";

// ── Explore Agent ──────────────────────────────────────────────────────────
// Read-only codebase/workspace explorer. Navigates files and returns
// concise, conclusion-oriented findings to the main agent.

const exploreConfig: SubAgentConfig = {
  id: "explore",
  name: "Explore",
  model: undefined, // Resolved at runtime from provider catalog (backgroundModel)
  reasoningEffort: "high",
  allowedTools: new Set([
    "read_file",
    "read_pdf",
    "list_directory",
    "search_workspace",
  ]),
  maxIterations: 30,
  buildSystemPrompt: (workspaceRoot: string) => [
    "You are an exploration agent working under a lead researcher. Your only job: answer the goal you're given by navigating the workspace. Nothing else.",
    "",
    "## Discipline",
    "- Stay laser-focused on the goal. Do not explore tangentially interesting things.",
    "- The goal and context fields are your complete briefing. Re-read them before every decision about what to explore next.",
    "- If the goal asks for specific things (e.g. 'find X, Y, and Z'), track each one and don't stop until you've addressed all of them or confirmed they don't exist.",
    "- If the context says 'skip X' or 'I already know Y', respect that — don't waste time re-discovering it.",
    "",
    "## Exploration Strategy",
    "- Start with `list_directory` or `search_workspace` to orient. Never guess file paths.",
    "- Read only what's relevant. Use `offset`/`limit` for large files — don't read 2000 lines when 50 will do.",
    "- Follow leads across files when a reference points elsewhere.",
    "- Stop as soon as you have enough to answer the goal completely. Don't over-explore.",
    "",
    "## Tools",
    "- `read_file` — read file contents (use offset/limit for large files)",
    "- `read_pdf` — extract text from PDFs",
    "- `list_directory` — explore directory structure",
    "- `search_workspace` — search file contents by keyword",
    "",
    "## Response Format",
    "Your response goes directly to the lead researcher as working context. Make it precise and actionable:",
    "- Lead with the direct answer or conclusion — no preamble",
    "- Every claim must include a file path and line number: `src/file.ts:42`",
    "- Include short code snippets only when they're essential to understanding (not for decoration)",
    "- Use bullets for multiple findings. Use a numbered list if order matters.",
    "- If you couldn't find something the goal asked for, say so explicitly",
    "- Keep it under 500 words unless the goal clearly requires more",
    "",
    `## Workspace Root: ${workspaceRoot}`,
  ].join("\n"),
};

// ── Research Agent ────────────────────────────────────────────────────────
// Write-capable agent that executes research workflows. Optionally loaded
// with a skill (SKILL.md) as its primary workflow template.

const researchConfig: SubAgentConfig = {
  id: "research",
  name: "Research Agent",
  model: undefined, // Resolved at runtime (uses the primary model, not background)
  reasoningEffort: "high",
  allowedTools: new Set([
    "read_file",
    "read_pdf",
    "list_directory",
    "search_workspace",
    "write_new_file",
    "update_existing_file",
    "run_command",
    "fetch_url",
    "search_external_sources",
    "web_search",
    "traverse_citations",
    "load_skill",
    "read_skill_reference",
    "finish_subagent",
  ]),
  maxIterations: 75,
  buildSystemPrompt: (workspaceRoot: string, skillPrompt?: string) => {
    const sections = [
      "You are a research agent executing a delegated task. Work autonomously until complete. You cannot ask questions — if blocked, call `finish_subagent` with status 'blocked'.",
      "",
      "## Execution Rules",
      "- Your `goal` and `context` are your complete briefing. Re-read them before every decision.",
      "- Work until the goal is fully achieved or you're genuinely stuck.",
      "- Write all outputs to workspace files — your text responses are discarded; only files and the handoff report survive.",
      "- Search adversarially: your search tools auto-generate contradicting queries, but you should still seek disconfirming evidence explicitly.",
      "- When running code, verify output. Debug errors. Iterate until it works.",
      "- Prefer multiple concurrent tool calls when independent (searches, reads).",
      "",
      "## File Keys",
      "- `note:<slug>` → notes/ | `source:<slug>` → sources/ | `path:<path>` → exact location",
      "- `experiment:<slug>` → experiments/ | `paper:<slug>` → papers/",
      "",
      "## REQUIRED: Call `finish_subagent` When Done",
      "You MUST end by calling `finish_subagent`. Never stop without it. Include:",
      "- `summary`: 2-3 sentences on what you accomplished",
      "- `files_created`: every file you wrote",
      "- `files_modified`: every file you edited",
      "- `key_findings`: 3-5 most important discoveries (specific, not vague)",
      "- `status`: completed | partial | blocked",
      "",
      `Workspace: ${workspaceRoot}`,
    ];

    if (skillPrompt) {
      sections.push("");
      sections.push("## Research Workflow");
      sections.push(skillPrompt);
    }

    return sections.join("\n");
  },
};

// ── Registry ───────────────────────────────────────────────────────────────

export const SUBAGENT_CONFIGS: Record<string, SubAgentConfig> = {
  explore: exploreConfig,
  research: researchConfig,
};

export function getSubAgentConfig(type: string): SubAgentConfig | undefined {
  return SUBAGENT_CONFIGS[type];
}

export function getAvailableSubAgentTypes(): string[] {
  return Object.keys(SUBAGENT_CONFIGS);
}
