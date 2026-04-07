# Bug: Ghost Renders of Live Activity Area During Tab Switch While Agent is Busy

**Severity:** High (visual breakage)  
**Date:** 2026-04-08  
**Status:** Open  
**Related:** `TAB-SWITCH-GHOST-RENDERS.md` (previous fix addressed Static area; this bug affects the dynamic/live area)

---

## Symptom

When the agent is actively processing (busy = true) and the user switches terminal tabs and returns, the **live activity area** — ThinkingIndicator, SubAgentIndicator, TaskPanel, tool activity in FooterBar — renders as **multiple stacked ghost copies** at different widths and positions. The screenshot shows "thinking..." and tool activity lines duplicated 6-8 times, some truncated to narrow widths, creating a severely broken display.

The existing fix in `TAB-SWITCH-GHOST-RENDERS.md` addressed ghost renders of **completed tool summaries in the Static area** (Ctrl+O + resize). This bug is specifically about the **non-Static (dynamic) portion** of the render tree that updates continuously during agent execution.

---

## Root Cause: Animated Timer Drives Re-renders During Ink's Broken Resize State

The bug is a compound interaction of three factors that are all active simultaneously when the agent is busy:

### Factor 1 (Primary): `useAnimatedFrame` fires every 120ms during busy state

```typescript
// src/tui/hooks/use-animated-frame.ts:5-13
export function useAnimatedFrame(active: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) { setIndex(0); return; }
    const timer = setInterval(() => setIndex((v) => (v + 1) % SPINNER_FRAMES.length), 120);
    return () => clearInterval(timer);
  }, [active]);
  return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}
```

When `busy = true`, this interval fires every **120ms**, each time calling `setIndex()` which triggers a full React re-render of the App component. This is normal during foreground operation — the spinner needs to animate.

**During a tab switch, this becomes the primary driver of ghost frames.** Ink's internal render state is corrupted by the resize (see Factor 2), and each 120ms tick pushes another broken frame to stdout.

### Factor 2 (Amplifier): Ink's resize handler corrupts render state

When the terminal tab is backgrounded, some terminals report `columns = 0` or a different width. Ink's internal `resized()` handler:

1. Calls `this.log.clear()`
2. Resets `lastOutput = ''` and `lastOutputToRender = ''`
3. Calls `calculateLayout()` + `onRender()`

When the tab returns, width restores → another resize → another `onRender()`. Since `lastOutput` was cleared, `output !== this.lastOutput` is always true, forcing full re-writes.

**Crucially:** Between the tab-away resize and tab-return resize, the animated timer is still firing (it's a `setInterval` — it doesn't pause when backgrounded). Each tick produces a render with the corrupted Ink state. These renders accumulate as ghost frames because Ink's output diffing is broken (lastOutput was wiped).

### Factor 3 (Amplifier): Multiple animated/polling components in the dynamic area

During busy state, the dynamic (non-Static) area contains several components that depend on `activityFrame` and frequently-updating state:

```tsx
// src/tui/app.tsx:1068-1090 (all in the dynamic area)
{showThinking && (
  <ThinkingIndicator frame={activityFrame} width={contentWidth} />   // ← animates
)}
{visibleSubAgents.map((progress) => (
  <SubAgentIndicator ... frame={activityFrame} width={contentWidth} /> // ← animates
))}
{taskPanelVisible && getVisibleTasks().length > 0 && (
  <TaskPanel tasks={getVisibleTasks()} frame={activityFrame} width={contentWidth} /> // ← animates
)}
```

And in the footer:
```tsx
// src/tui/app.tsx:1211-1223
<FooterBar
  width={contentWidth}
  busy={busy}
  frame={activityFrame}      // ← animates
  toolActivity={...}         // ← changes with each tool
  toolCount={...}
  ...
/>
```

Every component receives `activityFrame` (which changes 8x/second) and `contentWidth` (which can bounce during resize). Each re-render during the corrupted Ink state produces another ghost copy of the entire dynamic area.

### Factor 4: The resize debounce is insufficient

The existing debounce in `use-terminal-width.ts` (50ms) prevents the width state from bouncing. But the animated timer fires independently at 120ms intervals — the debounce doesn't stop those renders. The timer-driven renders happen while Ink's lastOutput is still empty (cleared by the away-resize), so every one of them triggers a full frame write.

---

## Exact Timeline

```
t=0ms     User switches away from terminal tab
t=1ms     Terminal reports columns=0 (or reduced)
t=2ms     Ink resized(): lastOutput = '', onRender()
t=50ms    useTerminalWidth debounce fires (width held stable — good)
t=120ms   useAnimatedFrame tick → setIndex → React re-render → Ink onRender()
            → lastOutput is '' → writes FULL frame (ghost #1)
t=240ms   Another tick → another full frame (ghost #2)
t=360ms   Another tick → ghost #3
...       (continues every 120ms while tab is in background)
t=2000ms  User switches back
t=2001ms  Terminal reports real columns
t=2002ms  Ink resized(): lastOutput = '' again, onRender()
t=2050ms  useTerminalWidth debounce fires → width updates → re-render
            → All accumulated ghost frames visible as stacked copies
```

In a typical 2-second tab switch, ~16 ghost frames are written (2000ms / 120ms).

---

## Why This Didn't Happen Before the Fix in TAB-SWITCH-GHOST-RENDERS.md

The previous fix removed `toolActivityExpanded` from the `<Static>` key, preventing Static area duplicates. But it didn't address the dynamic area because:

1. The dynamic area doesn't use `<Static>` — it's regular Ink `<Box>` output
2. The ghost frames come from Ink writing the entire non-Static output on every render when `lastOutput = ''`
3. The animated timer ensures renders keep happening even when the user isn't interacting

When the agent is **idle** (busy = false), `useAnimatedFrame` stops its interval → no timer-driven re-renders → no ghost frames during tab switch. The bug is only visible when `busy = true`.

---

## Affected Code Locations

| File | Lines | Role |
|------|-------|------|
| `src/tui/hooks/use-animated-frame.ts` | 5-13 | 120ms interval drives re-renders during busy state — primary ghost frame generator |
| `src/tui/app.tsx` | 142 | `activityFrame = useAnimatedFrame(busy)` — connected to busy state |
| `src/tui/app.tsx` | 1068-1090 | Dynamic area: ThinkingIndicator, SubAgentIndicator, TaskPanel — all receive `activityFrame` |
| `src/tui/app.tsx` | 1211-1223 | FooterBar receives `activityFrame` — also ghosts |
| `src/tui/hooks/use-terminal-width.ts` | 1-56 | Debounces width but can't prevent timer-driven renders |
| `node_modules/ink/build/ink.js` | 204-215 | Ink resets `lastOutput` on resize — causes full frame writes |

---

## Suggested Fixes

### Fix 1 (Critical): Pause the animation timer when the terminal is backgrounded

Detect when the terminal reports 0 or invalid columns and pause the animated frame timer. This is the single most impactful fix — it eliminates the source of ghost renders.

```typescript
// src/tui/hooks/use-animated-frame.ts
export function useAnimatedFrame(active: boolean) {
  const [index, setIndex] = useState(0);
  const { stdout } = useStdout();
  useEffect(() => {
    if (!active) { setIndex(0); return; }
    const timer = setInterval(() => {
      // Don't update animation when terminal is backgrounded
      const cols = (stdout as NodeJS.WriteStream & { columns?: number }).columns ?? 0;
      if (cols === 0) return;
      setIndex((v) => (v + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, [active, stdout]);
  return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}
```

When the tab is backgrounded (columns = 0), the timer still fires but skips the `setIndex` call, producing zero re-renders. When the tab returns (columns > 0), animation resumes naturally.

### Fix 2 (Defense in depth): Suppress all renders while terminal is backgrounded

Add a top-level guard in the App component that returns a minimal/empty render when the terminal width is 0 or suspiciously small:

```typescript
// src/tui/app.tsx — early in the render function
const terminalWidth = useTerminalWidth();
if (terminalWidth <= 0) {
  return null; // Terminal is backgrounded — don't render anything
}
```

This prevents ANY render output from reaching Ink while the terminal is in a broken state, regardless of what timers or state updates fire.

### Fix 3 (Defensive): Clear ghost frames on tab return

When the terminal width transitions from 0/invalid back to a real value (tab return), explicitly clear and re-render:

```typescript
// src/tui/hooks/use-terminal-width.ts — in the debounced handler
const commitWidth = () => {
  setTerminalWidth((current) => {
    const nextWidth = getStableObservedTerminalWidth(current, stream.columns, process.stdout.columns);
    if (nextWidth === current) return current;
    // If transitioning from backgrounded (MIN_TERMINAL_WIDTH) to real width,
    // write a clear-screen escape to flush ghost frames
    if (current === MIN_TERMINAL_WIDTH && nextWidth > MIN_TERMINAL_WIDTH) {
      process.stdout.write('\x1b[2J\x1b[H');
    }
    return nextWidth;
  });
};
```

This is a brute-force fallback — if ghosts do accumulate, they're wiped on tab return.

### Priority Order

1. **Fix 1** eliminates 90%+ of ghost frames by stopping the render-driving timer
2. **Fix 2** catches any remaining renders from other state updates (tool activity, sub-agent progress)
3. **Fix 3** is a safety net that cleans up any residual ghosts

---

## Reproduction Steps

1. Start the CLI with a workspace: `npm run dev`
2. Send a message that triggers a long-running agent turn (e.g., `"Search for papers on ontologies for agent memory"`)
3. While the agent is processing (spinner visible, "thinking..." or tool activity showing), **switch to another terminal tab**
4. Wait 2-3 seconds
5. **Switch back** to the open-research tab
6. **Observe:** Multiple ghost copies of "thinking...", tool activity lines, and task panel stacked vertically at varying widths
