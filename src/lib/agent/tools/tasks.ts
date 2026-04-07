import path from "node:path";
import { readJsonFile } from "@/lib/fs/json";
import fs from "node:fs/promises";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  sessionId?: string;
  subject: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  createdAt: string;
  completedAt?: string;
}

interface TaskStore {
  version: 1;
  tasks: Task[];
}

// ── State ──────────────────────────────────────────────────────────────────

let currentTasks: Task[] = [];
let storePath: string | null = null;
let currentSessionId: string | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

// ── Short ID ───────────────────────────────────────────────────────────────

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

// ── Persistence ────────────────────────────────────────────────────────────

function cloneTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => ({ ...task }));
}

async function persistSnapshot(snapshot: {
  storePath: string;
  sessionId: string;
  tasks: Task[];
}): Promise<void> {
  const data = await readJsonFile<TaskStore>(snapshot.storePath, { version: 1, tasks: [] });
  const foreignTasks = (data.tasks ?? []).filter(
    (task) => task.status !== "deleted" && task.sessionId !== snapshot.sessionId
  );
  const liveSessionTasks = snapshot.tasks.filter((task) => task.status !== "deleted");
  const mergedTasks = [...foreignTasks, ...liveSessionTasks];
  const tmpPath = snapshot.storePath + ".tmp";
  await fs.mkdir(path.dirname(snapshot.storePath), { recursive: true });
  await fs.writeFile(
    tmpPath,
    JSON.stringify({ version: 1, tasks: mergedTasks } satisfies TaskStore, null, 2),
  );
  await fs.rename(tmpPath, snapshot.storePath);
}

function schedulePersist(): Promise<void> {
  if (!storePath || !currentSessionId) return pendingWrite;

  const snapshot = {
    storePath,
    sessionId: currentSessionId,
    tasks: cloneTasks(currentTasks),
  };

  pendingWrite = pendingWrite
    .catch(() => undefined)
    .then(() => persistSnapshot(snapshot));
  void pendingWrite.catch(() => undefined);

  return pendingWrite;
}

function ensureSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = crypto.randomUUID();
  }
  return currentSessionId;
}

// ── Init / Clear ───────────────────────────────────────────────────────────

export async function initTaskStore(workspaceDir: string, sessionId = crypto.randomUUID()): Promise<void> {
  storePath = path.join(workspaceDir, ".open-research", "tasks.json");
  const data = await readJsonFile<TaskStore>(storePath, { version: 1, tasks: [] });
  currentSessionId = sessionId;
  currentTasks = (data.tasks ?? []).filter(
    (task) => task.status !== "deleted" && task.sessionId === currentSessionId
  );
}

export async function waitForTaskStoreWrites(): Promise<void> {
  await pendingWrite;
}

export function clearAllTasks(): void {
  currentTasks = [];
  void schedulePersist();
}

// ── Tool Executors ─────────────────────────────────────────────────────────

export function executeCreateTasks(
  args: { tasks: Array<{ subject: string; activeForm?: string }> }
): string {
  const sessionId = ensureSessionId();
  const created: Task[] = [];
  for (const item of args.tasks) {
    const task: Task = {
      id: shortId(),
      sessionId,
      subject: item.subject,
      activeForm: item.activeForm,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    currentTasks.push(task);
    created.push(task);
  }
  void schedulePersist();
  return created.map((t) => `[${t.id}] ${t.subject}`).join("\n");
}

export function executeUpdateTask(
  args: { taskId: string; status?: string; subject?: string; activeForm?: string }
): string {
  const task = currentTasks.find((t) => t.id === args.taskId);
  if (!task) return `Task not found: ${args.taskId}`;
  if (args.status) {
    task.status = args.status as Task["status"];
    if (args.status === "completed") {
      task.completedAt = new Date().toISOString();
    } else {
      delete task.completedAt;
    }
  }
  if (args.subject !== undefined) task.subject = args.subject;
  if (args.activeForm !== undefined) task.activeForm = args.activeForm;

  if (task.status === "deleted") {
    currentTasks = currentTasks.filter((candidate) => candidate.id !== task.id);
  }

  void schedulePersist();
  const label = task.status === "deleted" ? "deleted" : `${task.subject} → ${task.status}`;
  return `Task updated: ${label}`;
}

// ── Context Injection ──────────────────────────────────────────────────────

export function getTaskContextBlock(): string | null {
  const live = currentTasks.filter((t) => t.status !== "deleted");
  if (live.length === 0) return null;

  const lines = live.map((t) => {
    if (t.status === "completed") return `[x] ${t.subject}`;
    if (t.status === "in_progress") return `[>] ${t.activeForm ?? t.subject}`;
    return `[ ] ${t.subject}`;
  });
  return `## Active Tasks\n${lines.join("\n")}`;
}

// ── TUI Accessors ──────────────────────────────────────────────────────────

export function getVisibleTasks(): Task[] {
  return currentTasks.filter((t) => t.status !== "deleted");
}
