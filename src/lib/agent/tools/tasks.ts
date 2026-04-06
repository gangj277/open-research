import path from "node:path";
import { readJsonFile, writeJsonFile } from "@/lib/fs/json";
import fs from "node:fs/promises";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
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

let tasks: Task[] = [];
let storePath: string | null = null;

// ── Short ID ───────────────────────────────────────────────────────────────

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

// ── Persistence ────────────────────────────────────────────────────────────

async function persist(): Promise<void> {
  if (!storePath) return;
  const live = tasks.filter((t) => t.status !== "deleted");
  const tmpPath = storePath + ".tmp";
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify({ version: 1, tasks: live } satisfies TaskStore, null, 2));
  await fs.rename(tmpPath, storePath);
}

// ── Init / Clear ───────────────────────────────────────────────────────────

export async function initTaskStore(workspaceDir: string): Promise<void> {
  storePath = path.join(workspaceDir, ".open-research", "tasks.json");
  const data = await readJsonFile<TaskStore>(storePath, { version: 1, tasks: [] });
  tasks = data.tasks ?? [];
}

export function clearAllTasks(): void {
  tasks = [];
  void persist();
}

// ── Tool Executors ─────────────────────────────────────────────────────────

export function executeCreateTasks(
  args: { tasks: Array<{ subject: string; activeForm?: string }> }
): string {
  const created: Task[] = [];
  for (const item of args.tasks) {
    const task: Task = {
      id: shortId(),
      subject: item.subject,
      activeForm: item.activeForm,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    created.push(task);
  }
  void persist();
  return created.map((t) => `[${t.id}] ${t.subject}`).join("\n");
}

export function executeUpdateTask(
  args: { taskId: string; status?: string; subject?: string; activeForm?: string }
): string {
  const task = tasks.find((t) => t.id === args.taskId);
  if (!task) return `Task not found: ${args.taskId}`;
  if (args.status) {
    task.status = args.status as Task["status"];
    if (args.status === "completed") task.completedAt = new Date().toISOString();
  }
  if (args.subject !== undefined) task.subject = args.subject;
  if (args.activeForm !== undefined) task.activeForm = args.activeForm;
  void persist();
  const label = task.status === "deleted" ? "deleted" : `${task.subject} → ${task.status}`;
  return `Task updated: ${label}`;
}

// ── Context Injection ──────────────────────────────────────────────────────

export function getTaskContextBlock(): string | null {
  const live = tasks.filter((t) => t.status !== "deleted");
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
  return tasks.filter((t) => t.status !== "deleted");
}
