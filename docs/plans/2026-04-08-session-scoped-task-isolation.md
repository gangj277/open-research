# Session-Scoped Task Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make task tracking fully session-scoped so fresh sessions start clean, resumed sessions recover their own tasks, and concurrent sessions do not overwrite each other's task state.

**Architecture:** Keep the existing workspace-level `tasks.json` for backward compatibility, but treat it as a multi-session backing store. The runtime will load and mutate only the active session slice, while persistence will merge that slice back into disk state so other sessions are preserved. The TUI will pass the actual active session ID into task initialization and switch task scope when the user resumes an existing session.

**Tech Stack:** TypeScript, Node.js, Vitest, Ink/React

---

### Task 1: Lock the session-isolation contract with failing tests

**Files:**
- Create: `tests/agent/tasks.test.ts`

**Step 1: Write failing tests**

Add tests that verify:
- a fresh session cannot see tasks created by a different session
- task context injection is scoped to the active session only
- clearing tasks removes only the active session's tasks
- persisted disk state preserves tasks from multiple sessions for later resume

**Step 2: Run targeted tests to verify they fail**

Run: `npm test -- tests/agent/tasks.test.ts`

Expected: failures because the task store has no session scoping and rewrites shared state globally

### Task 2: Make the task store session-aware and safe for concurrent sessions

**Files:**
- Modify: `src/lib/agent/tools/tasks.ts`

**Step 1: Add session-aware state**

Track:
- active session ID
- active session task slice
- pending writes for deterministic ordered persistence

**Step 2: Scope all reads and writes**

Update:
- task creation to stamp the active session ID
- task updates to only target active-session tasks
- visible task and context accessors to only expose active-session tasks
- clear behavior to remove only active-session tasks

**Step 3: Merge on write**

When persisting:
- re-read `tasks.json`
- preserve foreign-session tasks and legacy tasks
- replace only the active-session slice
- write atomically

### Task 3: Wire active session identity through the TUI and resume flow

**Files:**
- Modify: `src/tui/app.tsx`

**Step 1: Make the app session ID stateful**

Replace the immutable generated session ID with state so the app can adopt a resumed session ID.

**Step 2: Reinitialize task scope when session changes**

Initialize the task store with `(workspacePath, sessionId)` and re-run that initialization whenever either value changes.

**Step 3: Resume into the selected session**

When the user resumes a saved session:
- switch the active session ID to the selected session's ID
- let the task store reload that session's tasks
- continue appending new chat events to the resumed session log

### Task 4: Verify the fix with focused and broader checks

**Files:**
- Test: `tests/agent/tasks.test.ts`
- Test: `tests/agent/tools.test.ts`

**Step 1: Run targeted regression tests**

Run: `npm test -- tests/agent/tasks.test.ts`

**Step 2: Run adjacent tool tests**

Run: `npm test -- tests/agent/tools.test.ts`

**Step 3: Run the full suite if the focused checks pass**

Run: `npm test`
