// ── Current Task Focus ────────────────────────────────────────────────────
// Lightweight module-level state for the agent's current focus.
// Injected into the system prompt every turn so the agent always knows
// what it's working on. Replaces the old create_tasks / update_task tools.

let currentTask: string | null = null;

export function executeSetCurrentTask(args: { task: string }): string {
  currentTask = args.task;
  return `Current focus set: ${args.task}`;
}

export function getCurrentTaskBlock(): string | null {
  if (!currentTask) return null;
  return `## Current Focus\n${currentTask}`;
}

export function getCurrentTask(): string | null {
  return currentTask;
}

export function clearCurrentTask(): void {
  currentTask = null;
}
