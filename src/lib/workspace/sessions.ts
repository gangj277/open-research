import fs from "node:fs/promises";
import path from "node:path";
import { getWorkspaceSessionsDir } from "@/lib/fs/paths";
import type { LLMMessage } from "@/lib/llm/types";
import type { TurnSnapshot } from "@/lib/snapshot/types";

export interface SessionEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export async function appendSessionEvent(
  workspaceDir: string,
  sessionId: string,
  event: SessionEvent
): Promise<void> {
  const sessionsDir = getWorkspaceSessionsDir(workspaceDir);
  await fs.mkdir(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
  await fs.appendFile(sessionFile, `${JSON.stringify(event)}\n`, "utf8");
}

// ── Session listing & resume ──────────────────────────────────────────────

export interface SavedSession {
  id: string;
  startedAt: string;
  lastActivity: string;
  preview: string;
  turnCount: number;
}

export interface RestoredSession {
  messages: Array<{ role: "user" | "assistant" | "system"; text: string }>;
  llmHistory: LLMMessage[];
  turnSnapshots: TurnSnapshot[];
}

function parseEvents(raw: string): SessionEvent[] {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SessionEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is SessionEvent => e !== null);
}

export async function listSessions(
  workspaceDir: string
): Promise<SavedSession[]> {
  const sessionsDir = getWorkspaceSessionsDir(workspaceDir);
  let files: string[];
  try {
    files = await fs.readdir(sessionsDir);
  } catch {
    return [];
  }

  const sessions: SavedSession[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const id = file.replace(/\.jsonl$/, "");
    const raw = await fs.readFile(path.join(sessionsDir, file), "utf8");
    const events = parseEvents(raw);
    if (events.length === 0) continue;

    const chatTurns = events.filter((e) => e.type === "chat.turn");
    const firstTurn = chatTurns[0];
    const preview = firstTurn
      ? String((firstTurn.payload as Record<string, unknown>).prompt ?? "").slice(0, 80)
      : "(empty session)";

    sessions.push({
      id,
      startedAt: events[0]!.timestamp,
      lastActivity: events[events.length - 1]!.timestamp,
      preview,
      turnCount: chatTurns.length,
    });
  }

  // Sort newest first
  sessions.sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );

  return sessions;
}

export async function loadSessionHistory(
  workspaceDir: string,
  sessionId: string
): Promise<RestoredSession> {
  const sessionsDir = getWorkspaceSessionsDir(workspaceDir);
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
  const raw = await fs.readFile(sessionFile, "utf8");
  const events = parseEvents(raw);

  const messages: RestoredSession["messages"] = [];
  const llmHistory: LLMMessage[] = [];
  const turnSnapshots: TurnSnapshot[] = [];

  for (const event of events) {
    if (event.type === "chat.turn") {
      const payload = event.payload as Record<string, unknown>;
      const prompt = String(payload.prompt ?? "");
      const response = String(payload.response ?? "");

      messages.push({ role: "user", text: prompt });
      messages.push({ role: "assistant", text: response });

      llmHistory.push({ role: "user", content: prompt });
      llmHistory.push({ role: "assistant", content: response });
    }

    // Restore from full history snapshot if available
    if (event.type === "history.snapshot") {
      const payload = event.payload as { llmHistory?: LLMMessage[] };
      if (payload.llmHistory) {
        llmHistory.length = 0;
        llmHistory.push(...payload.llmHistory);
      }
    }

    // Restore turn snapshots for revert support
    if (event.type === "snapshot.turn") {
      const payload = event.payload as TurnSnapshot;
      turnSnapshots.push(payload);
    }
  }

  return { messages, llmHistory, turnSnapshots };
}
