# Bug: Ghost Renders on Tab Switch During Agent Work

## Symptom

When the user switches away from the terminal tab while the agent is working (sub-agents running, tools executing, text streaming) and then switches back, the UI shows **duplicated, stale, and overlapping elements**: multiple copies of sub-agent progress indicators, thinking spinners, and tool activity summaries. The layout appears broken until the agent turn completes.

![Screenshot showing duplicated sub-agent indicators and broken layout after tab switch](screenshot-placeholder)

## Root Cause Analysis

There are **five cooperating bugs** that produce this behavior. Fixing any one in isolation reduces the severity, but a complete fix requires addressing all five.

---

### Bug 1: Animated frame timer queues state updates while terminal is hidden

**File:** `src/tui/hooks/use-animated-frame.ts:14-19`

```typescript
const timer = setInterval(() => {
  if (!hasRenderableTerminalDimensions(stdout)) {
    return; // ← skips the setIndex, but only based on dimension check
  }
  setIndex((v) => (v + 1) % SPINNER_FRAMES.length);
}, 120);
```

**Problem:** `hasRenderableTerminalDimensions` checks if `stdout.rows > 0` and `stdout.columns >= MIN_TERMINAL_WIDTH`. When the user switches tabs, some terminal emulators (iTerm2, Warp) do NOT report rows=0 — they keep the last known dimensions. The guard passes, and `setIndex()` fires every 120ms while the tab is invisible.

**Impact:** Every `setIndex()` triggers a React re-render cycle. When the user switches back, React flushes the accumulated render queue, and Ink redraws multiple frames in quick succession. Components that depend on `activityFrame` (ThinkingIndicator, SubAgentIndicator, PromptPrefix, FooterBar) all re-render with stale state snapshots from while the tab was hidden.

**Fix:** Track terminal visibility explicitly via `SIGTSTP`/`SIGCONT` signals or a `document.hidden`-equivalent for terminals. Pause the timer entirely when not visible, not just skip the state update:

```typescript
const [visible, setVisible] = useState(true);

useEffect(() => {
  const onSuspend = () => setVisible(false);
  const onResume = () => setVisible(true);
  process.on("SIGTSTP", onSuspend);
  process.on("SIGCONT", onResume);
  return () => {
    process.off("SIGTSTP", onSuspend);
    process.off("SIGCONT", onResume);
  };
}, []);

useEffect(() => {
  if (!active || !visible) { setIndex(0); return; }
  const timer = setInterval(() => {
    setIndex((v) => (v + 1) % SPINNER_FRAMES.length);
  }, 120);
  return () => clearInterval(timer);
}, [active, visible]);
```

**Caveat:** `SIGTSTP`/`SIGCONT` fires for Ctrl+Z suspend/resume but NOT for tab switching in multiplexed terminals (tmux, iTerm2 tabs). For that, you need a different signal — see Bug 5.

---

### Bug 2: Streaming buffer timer fires during backgrounding

**File:** `src/tui/streaming.ts:65-71`

```typescript
const scheduleFlush = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush(); // ← calls onFlush(text) which calls addAssistantMessage()
  }, flushIntervalMs);
};
```

**Problem:** The 80ms flush timer fires regardless of terminal visibility. `flush()` calls `onFlush()` which is `addAssistantMessage()` in app.tsx — this calls `setMessages()`, queuing a React state update. While the tab is hidden, dozens of message updates queue up. When the user switches back, they all flush, causing Ink to repeatedly re-render the conversation with slightly different message content, producing visual stutter.

**Fix:** Accept a visibility predicate in the buffer factory:

```typescript
export function createSentenceStreamBuffer({
  onFlush,
  isVisible = () => true,  // new param
  flushIntervalMs = STREAM_FLUSH_INTERVAL_MS,
  flushPattern = STREAM_FLUSH_PATTERN,
}) {
  // ...
  const flush = () => {
    if (!buffer || !isVisible()) return ""; // defer flush when hidden
    // ...
  };
}
```

Then in `app.tsx`, pass `isVisible: () => hasRenderableTerminalDimensions(stdout)`. When the terminal becomes visible again, the next `push()` or manual `flush()` drains the accumulated buffer in one shot.

---

### Bug 3: Sub-agent and tool activity state updates are not batched

**File:** `src/tui/app.tsx:626-658`

```typescript
onToolActivity: (activity) => {
  streamBuffer?.flush();
  if (activity.type === "tool_start") {
    setActiveToolActivities((current) => ({
      ...current,
      [activity.toolCallId]: activity.description ?? activity.name,
    }));
  } else {
    setActiveToolActivities((current) => { /* ... */ });
    turnToolLogRef.current.push({ /* ... */ });
    setTurnToolCount(turnToolLogRef.current.length);
  }
},
onSubAgentProgress: (progress) => {
  if (progress.status === "done") {
    setSubAgentProgress((current) => { /* delete */ });
  } else {
    setSubAgentProgress((current) => ({ ...current, [progress.agentId]: { ...progress } }));
  }
},
```

**Problem:** Each `tool_start`, `tool_end`, and sub-agent progress update is an individual `setState` call. During a typical sub-agent run, this fires dozens of times. React batches synchronous updates, but these arrive asynchronously (from the streaming API callback). Each update triggers a separate Ink render pass.

While the terminal is visible, Ink's differential rendering handles this fine — each frame only updates changed lines. But while the terminal is hidden, these renders accumulate. When the tab becomes visible, Ink does a full repaint (because it detects terminal dimensions changed or the cursor position is stale), and all the intermediate states flash on screen.

**Fix:** Debounce or batch these updates. Use a ref + requestAnimationFrame-style coalescing:

```typescript
const pendingActivityRef = useRef<Record<string, string>>({});
const activityFlushTimer = useRef<NodeJS.Timeout | null>(null);

function scheduleActivityFlush() {
  if (activityFlushTimer.current) return;
  activityFlushTimer.current = setTimeout(() => {
    activityFlushTimer.current = null;
    setActiveToolActivities({ ...pendingActivityRef.current });
  }, 32); // ~1 frame at 30fps
}
```

---

### Bug 4: Ink's `<Static>` component re-emits items on key change

**File:** `src/tui/app.tsx:875-885`

```tsx
<Static
  key={`conversation-static-${messageRenderVersion}`}
  items={staticRenderItems}
>
  {(item, index) => (
    <React.Fragment key={`conversation-static-item-${messageRenderVersion}-${index}`}>
      {item}
    </React.Fragment>
  )}
</Static>
```

**Problem:** `messageRenderVersion` increments only on `replaceMessages()` (line 372), not on individual streaming updates. The `Static` component's key stays the same across streaming additions. When Ink does a full repaint (triggered by tab switch + dimension re-read), `Static` re-renders all its items, but the internal "already written" tracking may get confused because the item count changed while the terminal was hidden.

This is an Ink-level issue: `Static` tracks which items it has already flushed to the terminal, but a full-screen clear (triggered by returning to the tab) resets the terminal output without resetting Static's internal counter. Result: items that were already written get written again.

**Fix:** After detecting a tab-return (visibility restored), force a single clean re-render by bumping `messageRenderVersion`:

```typescript
// On visibility restored
setMessageRenderVersion((v) => v + 1);
```

This gives `Static` a fresh key, forcing it to re-emit all items exactly once from a clean state, instead of having its internal counter desynchronized from the actual terminal content.

---

### Bug 5: No terminal visibility tracking mechanism

**Files:** `src/tui/app.tsx`, `src/tui/ink-stdout.ts`

**Problem:** The entire system lacks a centralized "is the terminal visible?" signal. The current approach (`hasRenderableTerminalDimensions`) is a heuristic that checks `rows > 0 && columns >= MIN_TERMINAL_WIDTH`. This fails for:

- **iTerm2 / Warp tabs**: Report full dimensions even when the tab is hidden
- **tmux panes**: Report dimensions of the pane allocation, not visibility
- **Screen readers**: May report nonzero dimensions

**Fix:** Create a centralized visibility tracker that combines multiple signals:

```typescript
// src/tui/hooks/use-terminal-visibility.ts

export function useTerminalVisibility(): boolean {
  const [visible, setVisible] = useState(true);
  const { stdout } = useStdout();

  useEffect(() => {
    // Signal 1: SIGTSTP/SIGCONT (Ctrl+Z suspend)
    const onSuspend = () => setVisible(false);
    const onResume = () => setVisible(true);
    process.on("SIGTSTP", onSuspend);
    process.on("SIGCONT", onResume);

    // Signal 2: stdout dimension collapse (some terminal emulators)
    const onResize = () => {
      const raw = getRawTerminalDimensions(stdout);
      if (raw.rows === 0 || raw.columns === 0) {
        setVisible(false);
      } else {
        setVisible(true);
      }
    };
    stdout.on("resize", onResize);

    return () => {
      process.off("SIGTSTP", onSuspend);
      process.off("SIGCONT", onResume);
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return visible;
}
```

Then pass `visible` down to `useAnimatedFrame`, the stream buffer, and the activity update handlers.

---

## Recommended Fix Priority

| Priority | Bug | Impact | Effort |
|----------|-----|--------|--------|
| **P0** | Bug 1 (animated frame timer) | Causes most of the visual duplication | Small — modify `use-animated-frame.ts` |
| **P0** | Bug 5 (no visibility tracking) | Root enabler for all other bugs | Medium — new hook, wire into app |
| **P1** | Bug 2 (streaming buffer timer) | Causes message stutter on return | Small — add visibility check to flush |
| **P1** | Bug 3 (unbatched state updates) | Amplifies render queue buildup | Medium — debounce callbacks |
| **P2** | Bug 4 (Static re-emission) | Causes duplicate message blocks | Small — bump render version on restore |

## Suggested Implementation Order

1. **Create `useTerminalVisibility` hook** (Bug 5) — this is the foundation all other fixes depend on
2. **Wire visibility into `useAnimatedFrame`** (Bug 1) — pause timer when `!visible`
3. **Wire visibility into stream buffer** (Bug 2) — defer flushes when `!visible`, drain on restore
4. **Debounce tool/sub-agent state updates** (Bug 3) — coalesce rapid updates into single renders
5. **Bump `messageRenderVersion` on visibility restore** (Bug 4) — reset Static's internal state

## Existing Test Coverage

`tests/tui/tab-switch-ghost-renders.test.tsx` has two relevant tests:

1. **"does not duplicate completed tool summaries after ctrl+o and resize churn"** (line 215) — Tests resize-triggered duplication, NOT actual tab-switch. Passes because it tests a different (already-fixed) code path.

2. **"stops busy animation writes while the terminal is backgrounded"** (line 268) — Simulates backgrounding by resizing to 0 rows. Verifies no additional `stdout.write()` calls happen. **This test passes but is insufficient** — it only checks write suppression, not state update suppression. The animation timer still fires `setIndex()` during the hidden period; the writes just happen to be blocked by the dimension check in `ink-stdout.ts`. When rows restore to normal, all queued state updates flush simultaneously.

### New tests needed

- Test that `useAnimatedFrame` stops firing `setIndex` when visibility is false
- Test that streaming buffer defers flushes and drains correctly on visibility restore
- Test that sub-agent progress updates during hidden period don't cause duplicate SubAgentIndicator renders on restore
- Test that `messageRenderVersion` bumps on visibility restore, ensuring Static re-renders cleanly

## Files to Modify

| File | Change |
|------|--------|
| `src/tui/hooks/use-terminal-visibility.ts` | **New** — centralized visibility hook |
| `src/tui/hooks/use-animated-frame.ts` | Accept `visible` param, pause timer when false |
| `src/tui/streaming.ts` | Accept `isVisible` predicate, defer flushes when hidden |
| `src/tui/app.tsx` | Use visibility hook, pass to animated frame and stream buffer, debounce activity callbacks, bump render version on restore |
| `src/tui/ink-stdout.ts` | Export visibility state (or expose via hook) |
| `tests/tui/tab-switch-ghost-renders.test.tsx` | Add tests for state update suppression, not just write suppression |

## Reproduction Steps

1. Start `npm run dev` in a terminal
2. Open a workspace and send a multi-step research query
3. While sub-agents are running (you see the orange progress indicators), switch to another terminal tab
4. Wait 5-10 seconds
5. Switch back — observe duplicated sub-agent indicators, broken layout
