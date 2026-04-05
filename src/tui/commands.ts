// ── Slash Command Definitions & Matching ────────────────────────────────────

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  category: "auth" | "workspace" | "session" | "system";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "auth", aliases: ["/connect", "/login"], description: "Connect your OpenAI account via browser OAuth", category: "auth" },
  { name: "auth-codex", aliases: ["/import-codex"], description: "Import auth from existing Codex CLI", category: "auth" },
  { name: "auth-status", aliases: [], description: "Check auth connection status", category: "auth" },
  { name: "logout", aliases: [], description: "Clear stored auth", category: "auth" },
  { name: "init", aliases: ["/workspace"], description: "Initialize a workspace in the current directory", category: "workspace" },
  { name: "skills", aliases: [], description: "List available research skills", category: "system" },
  { name: "resume", aliases: ["/sessions"], description: "Resume a previous session", category: "session" },
  { name: "clear", aliases: ["/new"], description: "Clear conversation and start fresh", category: "session" },
  { name: "help", aliases: ["/commands"], description: "Show available commands", category: "system" },
  { name: "config", aliases: ["/settings"], description: "View or change settings (e.g. /config theme dark)", category: "system" },
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

export function getUnifiedSuggestions(
  partial: string,
  allSkills: SkillSummary[]
): Suggestion[] {
  if (!partial.startsWith("/")) return [];
  const search = partial.slice(1).toLowerCase();
  if (!search) {
    const cmds: Suggestion[] = SLASH_COMMANDS.map((c) => ({
      kind: "command", name: c.name, description: c.description,
    }));
    const sk: Suggestion[] = allSkills.map((s) => ({
      kind: "skill", name: s.name, description: s.description, source: s.source,
    }));
    return [...cmds, ...sk].slice(0, 10);
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

  return [...cmdHits, ...skillHits].slice(0, 8);
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
  return matches.slice(0, 8).map((f) => ({
    kind: "file",
    path: f.path,
    label: f.label,
  }));
}

export function truncate(value: string, max = 96) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
