# Task Tracking

## Problem

When the agent performs multi-step research, the user has no visibility into where the agent is in its plan. Long autonomous runs are a black box. The agent itself also loses track of what it's done vs what's pending after compaction or long conversations.

## Design Principle

Keep it simple. 2 tools, not 4. No dependency graphs, no metadata, no ownership. A checklist the agent creates once and checks off as it works. If the plan changes, it can edit or delete individual tasks.

## Tools

### `create_tasks`

Creates one or more tasks. Used at the start of multi-step work.

```typescript
{
  tasks: Array<{
    subject: string;      // Required. Imperative: "Search for X", "Analyze Y"
    activeForm?: string;  // Optional. Spinner text: "Searching for X..."
                          // Falls back to subject if omitted
  }>;
}
```

Returns: list of created tasks with IDs.

**Schema description for the agent:**

```
Create research tasks to track multi-step work. Only create tasks when work involves 3+ distinct steps.
Don't create tasks for simple requests (one search, one file read, quick answer).
Tasks are shown to the user as a progress checklist and injected into your context on every turn,
so you always know what you've done and what's next.
```

### `update_task`

Updates a single task by ID.

```typescript
{
  taskId: string;                    // Required
  status?: "pending" | "in_progress" | "completed" | "deleted";
  subject?: string;                  // Rewrite the title
  activeForm?: string;               // Change spinner text
}
```

Status lifecycle: `pending` → `in_progress` → `completed`. Use `deleted` to remove.

**Schema description for the agent:**

```
Update a task's status or details.
- Set "in_progress" BEFORE starting work on a task.
- Set "completed" IMMEDIATELY after finishing — don't batch.
- Only mark completed when fully done. If work is partial or errored, keep in_progress.
- Set "deleted" to remove tasks that are no longer needed.
- Change subject to rewrite the plan when requirements change.
After completing a task, look at your task context to decide what to work on next.
```

## Data Model

```typescript
interface Task {
  id: string;           // Short ID (8-char hex) for easy agent reference
  subject: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  createdAt: string;    // ISO timestamp
  completedAt?: string;
}
```

Short IDs (8-char hex like `a1b2c3d4`) instead of full UUIDs — easier for the agent to reference in `update_task` calls without wasting tokens.

## Storage

File: `<workspace>/.open-research/tasks.json`

- Workspace-scoped — each project has its own tasks
- Plain JSON — human-readable
- Deleted tasks are stripped on write
- Atomic writes (write to tmp, rename) to prevent corruption

## Context Injection

**This is the key feature.** On every LLM call, if tasks exist, inject their state as a system-level context block in the messages array — same pattern as memories and AGENTS.md.

In `runtime.ts`, before building the messages array:

```typescript
const taskBlock = getTaskContextBlock(input.workspace.workspaceDir);
// Returns null if no tasks exist

const fullSystemPrompt = [
  systemPrompt,
  memoryBlock || null,
  agentsMd ? `## Project Context (from AGENTS.md)\n${agentsMd}` : null,
  taskBlock || null,  // <-- injected here
].filter(Boolean).join("\n\n");
```

The `getTaskContextBlock()` function returns:

```
## Active Tasks
[x] Search for chain-of-thought papers
[>] Reading and extracting from top 3 papers...
[ ] Build comparison table
[ ] Write analysis report
```

Format:
- `[x]` = completed
- `[>]` = in_progress (shows activeForm if set, otherwise subject)
- `[ ]` = pending
- Deleted tasks are not shown

This gives the agent persistent awareness of its plan across every turn — even after compaction (tasks are on disk, not in conversation history).

## System Prompt Addition

Minimal. Add to the system prompt in `runtime.ts`:

```
## Tasks
You can create a task checklist for multi-step work with `create_tasks` and update progress with `update_task`.
Tasks are injected into your context automatically — use them to stay on track.
Only create tasks for 3+ step work. One task should be in_progress at a time.
```

That's it. ~4 lines. The tool descriptions carry the behavioral rules.

## TUI

### TaskPanel Component

Rendered between conversation messages and the prompt area. Only shown when tasks exist.

```
  ⠋ Reading and extracting from top 3 papers...
  ○ Build comparison table
  ○ Write analysis report
  ✓ 1 completed
```

Design:
- **In-progress**: animated spinner + `activeForm` text (yellow/warning color)
- **Pending**: `○` with subject (default text color)
- **Completed**: collapsed into `✓ N completed` line (muted) — prevents the panel from growing forever
- **Deleted**: not shown
- `Ctrl+T` toggles panel visibility

### Integration

- **`/clear`**: clears tasks alongside messages
- **`/resume`**: tasks load from disk, agent sees prior incomplete work
- **Research Charter**: when approved, agent should create tasks from the charter's `proposedSteps`

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/agent/tools/tasks.ts` | Task store: create, update, get context block, persistence |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/agent/tool-schemas.ts` | Add 2 tool schemas (`create_tasks`, `update_task`) |
| `src/lib/agent/tool-dispatcher.ts` | Add 2 switch cases |
| `src/lib/agent/runtime.ts` | Inject task context block into messages; add ~4 lines to system prompt |
| `src/tui/components.tsx` | Add `TaskPanel` component |
| `src/tui/app.tsx` | Poll task state, render `TaskPanel`, `Ctrl+T` toggle, clear on `/clear` |

## Example Flow

User: "Find and analyze the top papers on chain-of-thought prompting"

**Turn 1 — Agent creates plan:**
```
create_tasks([
  { subject: "Search for chain-of-thought papers" },
  { subject: "Read and extract from top papers" },
  { subject: "Build comparison table" },
  { subject: "Write analysis report" }
])
update_task("a1b2c3d4", status: "in_progress", activeForm: "Searching for papers...")
// ... does the search ...
update_task("a1b2c3d4", status: "completed")
update_task("e5f6g7h8", status: "in_progress", activeForm: "Reading paper 1/5...")
```

**Turn 2 — Agent sees injected context:**
```
## Active Tasks
[x] Search for chain-of-thought papers
[>] Reading paper 3/5...
[ ] Build comparison table
[ ] Write analysis report
```

Agent knows exactly where it left off. Continues reading.

**Mid-work — plan changes:**
```
update_task("i9j0k1l2", subject: "Build comparison table for 3 papers")
update_task("m3n4o5p6", status: "deleted")  // report no longer needed
```

## What This Does NOT Have (intentionally)

- No dependency graph — agent works top-to-bottom, simple enough
- No metadata — tasks are a checklist, not a database
- No ownership — one agent, one session
- No `list_tasks` tool — agent sees tasks via context injection, doesn't need to query
- No `get_task` tool — tasks are simple enough that subject + status is sufficient
- No write queue — atomic file writes are sufficient for our single-agent model
- No task cap — system prompt guidance ("3+ steps") prevents overuse

These can be added later if we grow into multi-agent or cross-session coordination. For now, the simplest thing that works.
