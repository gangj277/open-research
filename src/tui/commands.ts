// ── Slash Command Definitions & Matching ────────────────────────────────────

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  category: "auth" | "workspace" | "session" | "system";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "auth", aliases: ["/connect", "/login"], description: "Connect your OpenAI account via browser OAuth", category: "auth" },
  { name: "auth-gemini", aliases: ["/login-gemini", "/gemini"], description: "Connect your Google account via browser OAuth (Gemini)", category: "auth" },
  { name: "auth-codex", aliases: ["/import-codex"], description: "Import auth from existing Codex CLI", category: "auth" },
  { name: "auth-status", aliases: [], description: "Check auth connection status", category: "auth" },
  { name: "logout", aliases: [], description: "Clear stored auth", category: "auth" },
  { name: "init", aliases: ["/workspace"], description: "Initialize a workspace in the current directory", category: "workspace" },
  { name: "skills", aliases: [], description: "List available research skills", category: "system" },
  { name: "resume", aliases: ["/sessions"], description: "Resume a previous session", category: "session" },
  { name: "clear", aliases: ["/new"], description: "Clear conversation and start fresh", category: "session" },
  { name: "help", aliases: ["/commands"], description: "Show available commands", category: "system" },
  { name: "config", aliases: ["/settings"], description: "View or change settings (e.g. /config theme dark)", category: "system" },
  { name: "compact", aliases: [], description: "Manually compress conversation to save context (e.g. /compact keep the statistics)", category: "session" },
  { name: "cost", aliases: ["/tokens", "/usage"], description: "Show token usage and cost for the current session", category: "system" },
  { name: "context", aliases: [], description: "Show context window usage — how full it is", category: "system" },
  { name: "btw", aliases: ["/aside"], description: "Ask a side question without affecting the main conversation", category: "session" },
  { name: "export", aliases: [], description: "Export conversation as markdown to a file", category: "session" },
  { name: "diff", aliases: ["/changes"], description: "Show files the agent has changed in this session", category: "workspace" },
  { name: "api-keys", aliases: ["/keys"], description: "Set API keys for Semantic Scholar, OpenAlex", category: "system" },
  { name: "doctor", aliases: [], description: "Diagnose auth, connectivity, and tool availability", category: "system" },
  { name: "preview", aliases: [], description: "Live preview a LaTeX file in browser (e.g. /preview papers/draft.tex)", category: "workspace" },
  { name: "memory", aliases: ["/memories"], description: "View or clear stored memories about you", category: "system" },
  { name: "ontology", aliases: ["/onto"], description: "View or manage the research ontology", category: "workspace" },
  { name: "exit", aliases: ["/quit", "/q"], description: "Exit Open Research", category: "system" },
];

export function matchSlashCommand(input: string): { cmd: SlashCommand; args: string } | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return null;
  const firstSpace = trimmed.indexOf(" ");
  const commandPart = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const argsPart = firstSpace === -1 ? "" : input.trim().slice(firstSpace + 1).trim();
  for (const cmd of SLASH_COMMANDS) {
    if (commandPart === `/${cmd.name}` || cmd.aliases.includes(commandPart)) {
      return { cmd, args: argsPart };
    }
  }
  return null;
}

// ── Suggestion Types & Matching ─────────────────────────────────────────────

export type Suggestion =
  | { kind: "command"; name: string; description: string }
  | { kind: "skill"; name: string; description: string; source: "builtin" | "user" }
  | { kind: "file"; path: string; label: string };

export interface SkillSummary {
  name: string;
  description: string;
  source: "builtin" | "user";
}

export interface WorkspaceFile {
  key: string;
  label: string;
  path: string;
  content: string;
}

// ── Subcommand Hints ────────────────────────────────────────────────────────
// When user types a command followed by a space, show contextual arg hints

interface SubcommandHint {
  name: string;
  description: string;
}

const SUBCOMMAND_HINTS: Record<string, SubcommandHint[]> = {
  "api-keys": [
    { name: "api-keys semantic-scholar <key>", description: "Set your Semantic Scholar API key" },
    { name: "api-keys openalex <key>", description: "Set your OpenAlex API key" },
    { name: "api-keys brave <key>", description: "Set Brave Search API key for better web search" },
  ],
  "config": [
    { name: "config theme dark|light", description: "Set color theme" },
    { name: "config auto-approve on|off", description: "Toggle auto-approve mode" },
  ],
  "memory": [
    { name: "memory clear", description: "Clear all global memories" },
    { name: "memory clear project", description: "Clear project memories" },
    { name: "memory clear all", description: "Clear everything" },
    { name: "memory delete <id>", description: "Delete a specific memory" },
  ],
  "compact": [
    { name: "compact", description: "Compress conversation (auto-selects what to keep)" },
    { name: "compact keep the statistical findings", description: "Compress but prioritize specific content" },
  ],
  "export": [
    { name: "export", description: "Export to conversation-export.md" },
    { name: "export <filename>", description: "Export to a specific file" },
  ],
  "preview": [
    { name: "preview <path-to-tex>", description: "Live preview a LaTeX file in browser" },
  ],
};

export function getUnifiedSuggestions(
  partial: string,
  allSkills: SkillSummary[]
): Suggestion[] {
  if (!partial.startsWith("/")) return [];

  // Check for subcommand hints: /api-keys<space>...
  if (partial.includes(" ")) {
    const spaceIdx = partial.indexOf(" ");
    const cmdPart = partial.slice(1, spaceIdx).toLowerCase();
    const hints = SUBCOMMAND_HINTS[cmdPart];
    if (hints) {
      const argPart = partial.slice(spaceIdx + 1).toLowerCase();
      const filtered = argPart
        ? hints.filter((h) => h.name.toLowerCase().includes(argPart))
        : hints;
      return filtered.map((h) => ({
        kind: "command" as const,
        name: h.name,
        description: h.description,
      }));
    }
    return [];
  }

  const search = partial.slice(1).toLowerCase();
  if (!search) {
    const cmds: Suggestion[] = SLASH_COMMANDS.map((c) => ({
      kind: "command", name: c.name, description: c.description,
    }));
    const sk: Suggestion[] = allSkills.map((s) => ({
      kind: "skill", name: s.name, description: s.description, source: s.source,
    }));
    return [...cmds, ...sk];
  }

  const cmdHits: Suggestion[] = SLASH_COMMANDS
    .filter(
      (c) =>
        c.name.startsWith(search) ||
        c.aliases.some((a) => a.slice(1).startsWith(search))
    )
    .map((c) => ({ kind: "command", name: c.name, description: c.description }));

  const skillHits: Suggestion[] = allSkills
    .filter((s) => s.name.includes(search))
    .map((s) => ({
      kind: "skill", name: s.name, description: s.description, source: s.source,
    }));

  return [...cmdHits, ...skillHits];
}

/** Extract the @mention token being typed. */
export function extractAtMention(text: string): { partial: string; start: number } | null {
  const lastAt = text.lastIndexOf("@");
  if (lastAt === -1) return null;
  if (lastAt > 0 && text[lastAt - 1] !== " ") return null;
  const after = text.slice(lastAt + 1);
  if (after.includes(" ")) return null;
  return { partial: after.toLowerCase(), start: lastAt };
}

export function getFileSuggestions(
  partial: string,
  files: WorkspaceFile[]
): Suggestion[] {
  const search = partial.toLowerCase();
  const matches = files.filter(
    (f) =>
      f.path.toLowerCase().includes(search) ||
      f.label.toLowerCase().includes(search)
  );
  return matches.map((f) => ({
    kind: "file",
    path: f.path,
    label: f.label,
  }));
}

export function truncate(value: string, max = 96) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
