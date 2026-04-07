import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearAllTasks,
  executeCreateTasks,
  executeUpdateTask,
  getTaskContextBlock,
  getVisibleTasks,
  initTaskStore,
} from "@/lib/agent/tools/tasks";

const tempDirs: string[] = [];
const initTaskStoreForSession = initTaskStore as unknown as (
  workspaceDir: string,
  sessionId?: string
) => Promise<void>;

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-task-store-"));
  tempDirs.push(dir);
  return dir;
}

function getTaskStorePath(workspaceDir: string): string {
  return path.join(workspaceDir, ".open-research", "tasks.json");
}

async function readTaskStore(workspaceDir: string): Promise<{
  version: number;
  tasks: Array<Record<string, unknown>>;
}> {
  const raw = await fs.readFile(getTaskStorePath(workspaceDir), "utf8");
  return JSON.parse(raw) as { version: number; tasks: Array<Record<string, unknown>> };
}

async function eventually(assertion: () => Promise<void> | void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("task store session scoping", () => {
  test("shows only the active session's tasks and restores them when that session is resumed", async () => {
    const dir = await makeTempDir();

    await initTaskStoreForSession(dir, "session-a");
    executeCreateTasks({
      tasks: [{ subject: "Trace prompt flow", activeForm: "Tracing prompt flow..." }],
    });

    await eventually(async () => {
      const store = await readTaskStore(dir);
      expect(store.tasks).toHaveLength(1);
    });

    expect(getVisibleTasks()).toHaveLength(1);
    expect(getTaskContextBlock()).toContain("Trace prompt flow");

    await initTaskStoreForSession(dir, "session-b");

    expect(getVisibleTasks()).toEqual([]);
    expect(getTaskContextBlock()).toBeNull();

    await initTaskStoreForSession(dir, "session-a");

    expect(getVisibleTasks()).toHaveLength(1);
    expect(getTaskContextBlock()).toContain("Trace prompt flow");
  });

  test("does not allow one session to update another session's task", async () => {
    const dir = await makeTempDir();

    await initTaskStoreForSession(dir, "session-a");
    executeCreateTasks({
      tasks: [{ subject: "Read top three papers" }],
    });

    await eventually(async () => {
      const store = await readTaskStore(dir);
      expect(store.tasks).toHaveLength(1);
    });

    const [task] = getVisibleTasks();
    expect(task).toBeDefined();

    await initTaskStoreForSession(dir, "session-b");

    const result = executeUpdateTask({
      taskId: task!.id,
      status: "completed",
    });

    expect(result).toContain("Task not found");

    await initTaskStoreForSession(dir, "session-a");
    expect(getVisibleTasks()[0]?.status).toBe("pending");
  });

  test("clears only the active session's tasks and preserves other sessions on disk", async () => {
    const dir = await makeTempDir();

    await initTaskStoreForSession(dir, "session-a");
    executeCreateTasks({
      tasks: [{ subject: "Session A task" }],
    });
    await eventually(async () => {
      const store = await readTaskStore(dir);
      expect(store.tasks).toHaveLength(1);
    });

    await initTaskStoreForSession(dir, "session-b");
    executeCreateTasks({
      tasks: [{ subject: "Session B task" }],
    });
    await eventually(async () => {
      const store = await readTaskStore(dir);
      expect(store.tasks).toHaveLength(2);
    });

    clearAllTasks();

    await eventually(async () => {
      const store = await readTaskStore(dir);
      const subjects = store.tasks.map((task) => task.subject);
      expect(subjects).toContain("Session A task");
      expect(subjects).not.toContain("Session B task");
    });

    await initTaskStoreForSession(dir, "session-a");
    expect(getVisibleTasks().map((task) => task.subject)).toEqual(["Session A task"]);
  });

  test("hides legacy tasks without a session id from new sessions", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, ".open-research"), { recursive: true });
    await fs.writeFile(
      getTaskStorePath(dir),
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "legacy001",
            subject: "Legacy task",
            status: "pending",
            createdAt: "2026-04-08T00:00:00.000Z",
          },
        ],
      }, null, 2),
      "utf8",
    );

    await initTaskStoreForSession(dir, "session-c");

    expect(getVisibleTasks()).toEqual([]);
    expect(getTaskContextBlock()).toBeNull();
  });
});
