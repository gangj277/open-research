# Parallel Tool Execution

## Problem

The agent runtime executes tool calls sequentially — even when the LLM returns multiple independent tool calls in a single response. If the agent dispatches 3 `launch_subagent` calls (e.g., search arXiv, Semantic Scholar, and explore the workspace simultaneously), they run one after another. A 10-second task that could finish in 4 seconds takes 30.

This is the single biggest performance bottleneck for research workflows where the agent frequently needs to read multiple files, search multiple sources, or dispatch multiple sub-agents.

## Current Behavior

In `src/lib/agent/runtime.ts`, the tool execution loop:

```typescript
for (const toolCall of toolCalls) {
  const result = await executeTool(toolCall.name, args, ...);  // sequential await
  messages.push({ role: "tool", tool_call_id: toolCall.id, content: result.result });
}
```

Every tool call waits for the previous one to finish. No concurrency.

## Design

### Tool Classification

Each tool declares whether it's safe to run concurrently. The classification rule: **a tool is parallel-safe if it has no side effects on the workspace or shared state.**

| Tool | Parallel Safe | Reason |
|------|--------------|--------|
| `read_file` | Yes | Read-only |
| `read_pdf` | Yes | Read-only |
| `list_directory` | Yes | Read-only |
| `search_workspace` | Yes | Read-only |
| `search_external_sources` | Yes | Read-only, external API |
| `fetch_url` | Yes | Read-only, external |
| `launch_subagent` | Yes | Isolated context, read-only tools only (explore type) |
| `load_skill` | Yes | Read-only metadata |
| `read_skill_reference` | Yes | Read-only |
| `write_new_file` | No | Creates files |
| `update_existing_file` | No | Modifies files |
| `run_command` | No | Arbitrary shell side effects |
| `ask_user` | No | Blocks on user input, must be exclusive |
| `create_paper` | No | Creates files |

### Schema Change

Add a `parallelSafe` boolean to the tool registry. This is an internal flag, not sent to the LLM.

```typescript
// src/lib/agent/tool-schemas.ts

interface ToolMeta {
  parallelSafe: boolean;
}

const TOOL_META: Record<string, ToolMeta> = {
  read_file: { parallelSafe: true },
  read_pdf: { parallelSafe: true },
  list_directory: { parallelSafe: true },
  search_workspace: { parallelSafe: true },
  search_external_sources: { parallelSafe: true },
  fetch_url: { parallelSafe: true },
  launch_subagent: { parallelSafe: true },
  load_skill: { parallelSafe: true },
  read_skill_reference: { parallelSafe: true },
  write_new_file: { parallelSafe: false },
  update_existing_file: { parallelSafe: false },
  run_command: { parallelSafe: false },
  ask_user: { parallelSafe: false },
  create_paper: { parallelSafe: false },
};

export function isParallelSafe(toolName: string): boolean {
  return TOOL_META[toolName]?.parallelSafe ?? false;
}
```

### Runtime Change

Replace the sequential loop in `runtime.ts` with a two-phase execution:

```typescript
// Phase 1: Split tool calls into parallel-safe and sequential groups
const parallelCalls = toolCalls.filter(tc => isParallelSafe(tc.name));
const sequentialCalls = toolCalls.filter(tc => !isParallelSafe(tc.name));

// Phase 2: Run parallel-safe tools concurrently
const parallelResults = await Promise.all(
  parallelCalls.map(async (toolCall) => {
    const args = JSON.parse(toolCall.arguments || "{}");
    // Emit tool_start
    input.onToolActivity?.({ type: "tool_start", name: toolCall.name, description: describeToolCall(toolCall.name, args) });
    const startTime = Date.now();
    const result = await executeTool(toolCall.name, args, input.workspace, activeSkills, input.homeDir, signal, input.provider, input.onSubAgentProgress);
    const durationMs = Date.now() - startTime;
    // Emit tool_end
    input.onToolActivity?.({ type: "tool_end", name: toolCall.name, description: describeToolCall(toolCall.name, args), durationMs });
    return { toolCall, result };
  })
);

// Push all parallel results to messages
for (const { toolCall, result } of parallelResults) {
  if (result.proposedUpdate) proposedUpdates.push(result.proposedUpdate);
  if (result.searchResults) searchResults.push(...result.searchResults.map(/*...*/));
  messages.push({ role: "tool", tool_call_id: toolCall.id, content: result.result });
}

// Phase 3: Run sequential tools one at a time (order matters)
for (const toolCall of sequentialCalls) {
  // ... existing sequential execution logic
}
```

### TUI Changes

The footer already shows the current tool activity. With parallel execution:

- Show the number of concurrent tools: `"⠋ Running 3 tools in parallel (2 done)"`
- Sub-agent indicators stack if multiple are active simultaneously
- Tool activity summary groups parallel and sequential tools naturally (no change needed — the existing `buildToolSummary` handles any order)

### Edge Cases

**Mixed parallel + sequential in one response:**
Run all parallel-safe tools first via `Promise.all`, then run sequential tools in order. This ensures write operations see the results of reads.

**Multiple `ask_user` calls:**
The LLM should never emit multiple `ask_user` calls in one response (the system prompt discourages it), but if it does, they must run sequentially. The classification handles this.

**Sub-agent progress with multiple sub-agents:**
Multiple `launch_subagent` calls will fire `onSubAgentProgress` concurrently. The TUI needs to handle multiple active sub-agent indicators. Store as `Map<string, SubAgentProgress>` keyed by a unique ID instead of a single `SubAgentProgress | null`.

**Abort signal:**
All parallel `Promise.all` executions share the same `AbortSignal`. If the user presses Esc, all in-flight tool calls are cancelled.

**Error handling:**
Use `Promise.allSettled` instead of `Promise.all` to prevent one failure from killing all parallel tools. Failed tools return an error message as the tool result, allowing the LLM to handle the failure.

### System Prompt Update

Add to the system prompt so the LLM knows it can dispatch multiple tools:

```
When you need to perform multiple independent operations (reading several files, searching multiple sources, launching multiple sub-agents), invoke all tools in a single response. They will execute concurrently for maximum speed.
```

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/agent/tool-schemas.ts` | Add `TOOL_META` registry and `isParallelSafe()` |
| `src/lib/agent/runtime.ts` | Replace sequential tool loop with parallel/sequential split |
| `src/lib/agent/runtime.ts` | Update system prompt with parallel dispatch guidance |
| `src/tui/app.tsx` | Change `subAgentProgress` from single to Map for multiple concurrent sub-agents |
| `src/tui/app.tsx` | Render multiple `SubAgentIndicator` components |

## Testing

1. Ask the agent to "read these 5 files: a.ts, b.ts, c.ts, d.ts, e.ts" — verify all 5 execute concurrently (total time ~= slowest single read, not sum)
2. Ask the agent to "search for X on arXiv and Semantic Scholar simultaneously" — verify both searches run in parallel
3. Ask the agent to explore the codebase with multiple sub-agents — verify sub-agents run concurrently with separate TUI indicators
4. Ask the agent to "read file.ts then edit it" — verify read runs first, edit runs after (mixed parallel + sequential)
5. Press Esc during parallel execution — verify all tools cancel cleanly

## Impact

For a typical research turn where the agent reads 5 files, searches 2 databases, and explores 1 directory:
- **Before**: ~8 sequential API calls, total ~12s
- **After**: ~3 parallel batches (reads, searches, directory), total ~4s
- **3x speedup** on tool-heavy turns
