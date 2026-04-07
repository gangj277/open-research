# Bug: Tasks From Previous Sessions Shown in New Sessions

**Severity:** Medium (UX confusion)  
**Date:** 2026-04-08  
**Status:** Open  
**Affected area:** Task persistence, session scoping

---

## Symptom

When a user opens a **new session** in a separate terminal tab (same workspace directory), tasks created by a **previous session** are displayed in the task panel. Tasks should be ephemeral to the session that created them — a fresh session should start with zero tasks.

---

## Root Cause: Tasks Are Workspace-Scoped, Not Session-Scoped

The entire task system has **no concept of sessions**. Tasks are persisted to a single global file per workspace and loaded in full by every session that starts in that directory.

### The Storage Model

```
.open-research/
  tasks.json          ← ONE file, ALL sessions read/write here
  sessions/
    {sessionA}.jsonl   ← session A events (chat turns, etc.)
    {sessionB}.jsonl   ← session B events
```

Sessions are isolated for chat history (`sessions/{id}.jsonl`), but tasks share a single `tasks.json` with no session association.

### The Data Structure

```typescript
// src/lib/agent/tools/tasks.ts:7-14
export interface Task {
  id: string;
  subject: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  createdAt: string;
  completedAt?: string;
  // ← no sessionId field
}
```

No `sessionId` field exists on the `Task` interface.

### The Module-Level Singleton

```typescript
// src/lib/agent/tools/tasks.ts:23-24
let tasks: Task[] = [];        // global array, shared across all callers
let storePath: string | null = null;
```

This is module-level state — a process-global singleton. Every function in this file operates on the same `tasks` array.

---

## Exact Code Flow

### 1. Session A starts, creates tasks

```
app.tsx:138     → sessionId = crypto.randomUUID()   // "aaa-111"
app.tsx:256     → initTaskStore(workspacePath)
tasks.ts:45-48  → reads .open-research/tasks.json (empty)
                → tasks = []

Agent creates tasks during its turn:
tasks.ts:58-74  → executeCreateTasks({ tasks: [...] })
                → pushes Task{id:"abc", subject:"..."} to tasks[]
                → NO sessionId attached
tasks.ts:34-41  → persist() writes tasks[] to tasks.json
```

### 2. Session B starts in a new terminal tab

```
app.tsx:138     → sessionId = crypto.randomUUID()   // "bbb-222"
app.tsx:256     → initTaskStore(workspacePath)
tasks.ts:45-48  → reads .open-research/tasks.json
                → tasks = [Task{id:"abc", ...}]  ← Session A's tasks loaded!

app.tsx:1084    → getVisibleTasks() returns Session A's tasks
                → TaskPanel renders them
```

Session B sees Session A's tasks immediately. The user didn't ask for them and has no context for what they are.

### 3. Cross-contamination continues

If Session B creates its own tasks, they're appended to the same `tasks[]` array and persisted to the same `tasks.json`. If Session A is still running, it won't see them until it re-reads the file (which it doesn't — it uses the in-memory array). But the next Session C will load ALL of them.

---

## Why `getVisibleTasks()` Shows Everything

```typescript
// src/lib/agent/tools/tasks.ts:109-111
export function getVisibleTasks(): Task[] {
  return tasks.filter((t) => t.status !== "deleted");
}
```

The only filter is `status !== "deleted"`. There is no session filter.

### Same for context injection into the LLM

```typescript
// src/lib/agent/tools/tasks.ts:95-105
export function getTaskContextBlock(): string | null {
  const live = tasks.filter((t) => t.status !== "deleted");
  if (live.length === 0) return null;
  // ...
}
```

This means the agent also sees stale tasks from other sessions in its context window, potentially confusing it.

---

## Affected Code Locations

| File | Lines | Issue |
|------|-------|-------|
| `src/lib/agent/tools/tasks.ts` | 7-14 | `Task` interface has no `sessionId` field |
| `src/lib/agent/tools/tasks.ts` | 23-24 | Module-level singleton — no session isolation |
| `src/lib/agent/tools/tasks.ts` | 45-48 | `initTaskStore()` loads all tasks, no session filter |
| `src/lib/agent/tools/tasks.ts` | 58-74 | `executeCreateTasks()` doesn't tag tasks with sessionId |
| `src/lib/agent/tools/tasks.ts` | 109-111 | `getVisibleTasks()` returns all non-deleted tasks |
| `src/lib/agent/tools/tasks.ts` | 95-105 | `getTaskContextBlock()` injects all tasks into LLM context |
| `src/tui/app.tsx` | 138 | `sessionId` is generated but never passed to task system |
| `src/tui/app.tsx` | 256-258 | `initTaskStore()` called without sessionId |

---

## Suggested Fix

### Option A: Add `sessionId` to the Task interface (recommended)

Minimal change, backward-compatible with existing `tasks.json` files.

**1. Add sessionId to Task:**
```typescript
export interface Task {
  id: string;
  sessionId: string;        // ← new
  subject: string;
  // ...
}
```

**2. Pass sessionId through to task creation:**
- `initTaskStore(workspaceDir, sessionId)` — store session context
- `executeCreateTasks()` — attach `sessionId` to each new task
- Module-level `let currentSessionId: string` alongside `storePath`

**3. Filter by sessionId on read:**
```typescript
export function getVisibleTasks(): Task[] {
  return tasks.filter((t) => t.status !== "deleted" && t.sessionId === currentSessionId);
}

export function getTaskContextBlock(): string | null {
  const live = tasks.filter((t) => t.status !== "deleted" && t.sessionId === currentSessionId);
  // ...
}
```

**4. Persist ALL tasks (cross-session) but only display current session's:**
This preserves history. Old session tasks remain in `tasks.json` but are invisible to new sessions. They can be cleaned up by a separate garbage-collection pass (e.g., delete tasks older than 7 days).

**5. Wire sessionId from app.tsx:**
```typescript
// app.tsx — in workspace init
void initTaskStore(workspacePath, sessionId).then(() => {
  if (!cancelled) setTaskVersion((v) => v + 1);
});
```

### Option B: Per-session task files

Store tasks in `sessions/{sessionId}/tasks.json` instead of a global file. Simpler isolation but loses the ability to see/resume tasks from previous sessions.

### Option A is recommended because:
- Backward compatible — old `tasks.json` files still load (tasks without `sessionId` are simply hidden)
- Preserves task history for potential "resume session" features
- Minimal code change — only `tasks.ts` and one line in `app.tsx`
- The `sessionId` on `app.tsx:138` already exists and just needs to be passed down
