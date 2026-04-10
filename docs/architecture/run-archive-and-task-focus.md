# Run Archive & Task Focus System

## Overview

The agent uses a **file-based run archive** combined with a lightweight **current task focus** tool to track multi-step research work. Instead of dedicated task management tools with in-memory state, the agent writes plan files to disk and updates them as it works — creating a persistent, human-readable archive of every research run.

## How It Works

### `set_current_task` Tool

A single tool that sets the agent's current focus. The system stores this in memory and injects it into the system prompt on every LLM turn, so the agent always knows what it's working on.

```
Agent calls: set_current_task({ task: "Searching for scaling law papers" })

System prompt injection:
## Current Focus
Searching for scaling law papers
```

The focus is ephemeral (per-process, not persisted). It exists purely to keep the agent oriented within a run.

**Implementation:** `src/lib/agent/tools/current-task.ts` — three functions:
- `executeSetCurrentTask(args)` — sets the focus, returns confirmation
- `getCurrentTaskBlock()` — returns the system prompt block or null
- `clearCurrentTask()` — resets (called by `/clear` slash command)

### Run Archive

For multi-step tasks, the agent creates a plan file at the start of the run:

```
run/archive/2026-04-10T14-30-00/plan.md
```

The plan uses markdown checklists:

```markdown
# Research Plan: Scaling Laws in Language Models

- [ ] Search for foundational scaling law papers
- [ ] Extract key findings and methodology
- [ ] Identify contradictions across studies
- [ ] Write synthesis note
```

As the agent works, it updates the plan via `update_existing_file` (targeted mode) to check off items and add findings. Both creation and edits are **auto-approved** — no user review prompt.

### Auto-Approve Policy

The `run/` directory receives special treatment in `src/lib/agent/review-policy.ts`:

- **New files** in `run/` → auto-applied (same as `notes/`, `sources/`, `artifacts/`)
- **Edits** to files in `run/` → also auto-applied (unlike other managed directories which require review for edits)

This is necessary because the agent creates `plan.md` then edits it repeatedly within a single run. Requiring user approval on each checkbox update would break the flow.

### Same-Turn File Access

When the agent creates a file via `write_new_file` and it's auto-approved, the file is immediately written to disk **and** injected back into the live workspace context (`ctx.workspaceFiles`). This allows `update_existing_file` to find the file in subsequent tool-loop iterations within the same turn.

This propagation happens in `src/lib/agent/runtime.ts` inside the tool result processing loop:

```typescript
if (result.proposedUpdate) {
  const risk = classifyUpdateRisk(result.proposedUpdate);
  if (risk.policy === "auto-apply") {
    await applyProposedUpdate(workspaceDir, result.proposedUpdate);
    workspace.workspaceFiles[update.key] = update.content;
    workspace.availableKeys.push(update.key);
  }
}
```

## Directory Structure

```
workspace/
├── run/
│   └── archive/
│       ├── 2026-04-10T14-30-00/
│       │   └── plan.md
│       ├── 2026-04-11T09-15-22/
│       │   └── plan.md
│       └── ...
├── notes/
├── sources/
├── papers/
├── experiments/
└── artifacts/
```

The `run/` directory is created on workspace initialization (listed in `MANAGED_DIRS` in `src/lib/workspace/project.ts`).

## System Prompt Instructions

The agent receives these instructions in its system prompt (from `buildSystemPrompt()` in `runtime.ts`):

```
## Run Archive
At the start of every multi-step research task, create a plan file:
- Use `write_new_file` with key `path:run/archive/{YYYY-MM-DDTHH-MM-SS}/plan.md`
- Structure it as a markdown checklist with context about each step
- As you complete steps, use `update_existing_file` to check off items and add findings
- Call `set_current_task` before starting each step so your focus is always clear
This creates a persistent archive of your research process that compounds as knowledge.
For simple single-step requests, skip the plan file — just use `set_current_task`.
```

## Key Files

| File | Role |
|------|------|
| `src/lib/agent/tools/current-task.ts` | Module-level focus state + tool executor |
| `src/lib/agent/tool-schemas.ts` | `set_current_task` schema definition |
| `src/lib/agent/tool-dispatcher.ts` | Routes `set_current_task` to executor |
| `src/lib/agent/runtime.ts` | Context injection, system prompt, auto-apply propagation |
| `src/lib/agent/review-policy.ts` | Auto-approve logic for `run/` directory |
| `src/lib/workspace/project.ts` | `run` in `MANAGED_DIRS` for workspace init |

## Design Rationale

**Why not dedicated task tools?** The previous system had `create_tasks` and `update_task` tools backed by in-memory state, a persistence layer, a TUI panel, and a server bridge. This was over-engineered — the agent already has `write_new_file` and `update_existing_file`. Writing a markdown checklist is the same operation with zero additional tooling.

**Why a file-based archive?** Three benefits:
1. **Persistence** — every run's plan survives on disk. Six months later, you can trace how a research question evolved.
2. **Knowledge compounding** — the agent (or a sub-agent) can read past `run/archive/*/plan.md` files to understand prior attempts and dead ends.
3. **Simplicity** — no in-memory state management, no session scoping, no persistence layer. Just files.

**Why keep `set_current_task`?** The plan file tracks the full task list. The current focus tracks what the agent is doing *right now*. It's injected into the system prompt every turn as a lightweight reminder — much cheaper than re-reading the plan file on every iteration.
