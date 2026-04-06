# Parallel Tool Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the agent runtime's sequential tool-call bottleneck by executing parallel-safe tool batches concurrently while preserving tool-call semantics, cancellation, and TUI visibility.

**Architecture:** Add internal tool metadata for concurrency classification, then replace the runtime's one-by-one tool loop with ordered execution batches: consecutive parallel-safe calls run together with `Promise.allSettled`, while side-effecting or blocking tools still run exclusively in sequence. Extend runtime activity/progress events with stable IDs so the TUI can track multiple active tools and sub-agents at once without losing state.

**Tech Stack:** TypeScript, Node.js, Vitest, Ink/React

---

### Task 1: Lock the runtime contract with failing tests

**Files:**
- Create: `tests/agent/runtime.parallel.test.ts`
- Create: `tests/agent/tool-schemas.test.ts`

**Step 1: Write the failing tests**

Add tests that verify:
- tool metadata correctly marks read-only tools as parallel-safe and side-effecting tools as sequential-only
- `runAgentTurn()` executes consecutive parallel-safe tool calls concurrently instead of serially
- mixed batches preserve original order, so a sequential tool forms a barrier between parallel groups
- a failed parallel-safe tool is surfaced as a tool result without cancelling sibling tool calls
- the system prompt tells the model to emit multiple independent tools in one response

**Step 2: Run targeted tests to verify they fail**

Run: `npm test -- tests/agent/tool-schemas.test.ts tests/agent/runtime.parallel.test.ts`

Expected: failures for missing tool metadata helpers and the still-sequential runtime loop

### Task 2: Lock the concurrent TUI behavior with failing tests

**Files:**
- Create: `tests/tui/parallel-tool-activity.test.tsx`

**Step 1: Write the failing tests**

Add tests that verify:
- the footer shows a parallel activity summary when multiple tools are in flight
- multiple concurrent sub-agent progress events render multiple indicators at the same time
- indicator removal is keyed to the specific completed sub-agent instead of clearing all progress

**Step 2: Run the TUI test to verify it fails**

Run: `npm test -- tests/tui/parallel-tool-activity.test.tsx`

Expected: failures because the app only tracks one current tool string and one sub-agent progress object

### Task 3: Add internal concurrency metadata for tools

**Files:**
- Modify: `src/lib/agent/tool-schemas.ts`

**Step 1: Add a tool metadata registry**

Create a typed internal registry that records whether each tool is parallel-safe.

**Step 2: Export helpers**

Expose:
- `isParallelSafe(toolName)`
- any small helper needed to validate classification or derive execution decisions

### Task 4: Replace the runtime tool loop with ordered parallel batches

**Files:**
- Modify: `src/lib/agent/runtime.ts`
- Modify: `src/lib/agent/tool-dispatcher.ts`

**Step 1: Extend activity/progress events with stable IDs**

Add per-tool-call IDs to tool activity events and bind sub-agent progress to the parent tool call ID.

**Step 2: Batch tool execution**

Implement an ordered batching helper that:
- groups consecutive parallel-safe tool calls
- executes each group with `Promise.allSettled`
- emits start/end activity per tool
- preserves original tool-call order when appending `tool` messages back into the conversation

**Step 3: Preserve failure isolation**

Convert rejected parallel executions into error-like tool results so the LLM can recover naturally.

**Step 4: Update the system prompt**

Tell the model to bundle independent reads/searches/sub-agent launches into one response because the runtime now executes them concurrently.

### Task 5: Upgrade the TUI for concurrent visibility

**Files:**
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/components.tsx`
- Modify: `src/lib/agent/subagent/types.ts`

**Step 1: Track active tools by ID**

Replace the single current activity string with keyed active-tool state plus completed-count bookkeeping for the current turn.

**Step 2: Track active sub-agents by ID**

Replace the single `SubAgentProgress | null` with a keyed collection so multiple agents can be shown simultaneously.

**Step 3: Render concurrent state**

Update the footer and sub-agent indicator rendering to show:
- `Running N tools in parallel (M done)` when appropriate
- one card per active sub-agent

### Task 6: Verify end to end

**Files:**
- Test: `tests/agent/tool-schemas.test.ts`
- Test: `tests/agent/runtime.parallel.test.ts`
- Test: `tests/tui/parallel-tool-activity.test.tsx`

**Step 1: Run targeted verification**

Run: `npm test -- tests/agent/tool-schemas.test.ts tests/agent/runtime.parallel.test.ts tests/tui/parallel-tool-activity.test.tsx`

**Step 2: Run broader verification**

Run: `npm test`

**Step 3: Review residual risks**

Check for any assumptions around single in-flight tool activity or single sub-agent state in untouched UI/tests, then patch only if the broader suite exposes a real regression.
