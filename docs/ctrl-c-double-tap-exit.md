# Ctrl+C Double-Tap to Exit

## Summary

Currently, pressing Ctrl+C immediately kills the CLI process. This is jarring — a single accidental Ctrl+C loses the entire session with no warning. Instead, implement a "double-tap" pattern: the first Ctrl+C shows a warning, and only a second Ctrl+C within 3 seconds actually exits.

## Current Behavior

- User presses Ctrl+C → process exits immediately
- No confirmation, no chance to cancel
- Any unsaved conversation state is lost

## Desired Behavior

1. **First Ctrl+C** → show a status message: `Press Ctrl+C again to exit` (or similar)
2. **Second Ctrl+C within 3 seconds** → exit the CLI
3. **No second Ctrl+C within 3 seconds** → the warning clears, back to normal
4. **If the agent is busy** → first Ctrl+C should interrupt/abort the agent (same as Esc currently does), NOT trigger the exit flow. Only Ctrl+C when idle should trigger the double-tap exit.

## Implementation

### Where Ctrl+C is handled

Ink intercepts Ctrl+C at two layers:

1. **Ink's internal handler** (`App.js`) — checks `exitOnCtrlC` option (defaults to `true`). When enabled, Ink calls `handleExit()` which unmounts the app and exits. This happens **before** any `useInput` handler fires.

2. **Our `useInput` in `text-input.tsx`** — has `(key.ctrl && input === "c")` as a pass-through (returns early, doesn't handle it). It never reaches our handler because Ink kills the process first.

### What needs to change

**Step 1: Disable Ink's built-in Ctrl+C exit**

In `cli.ts`, pass `exitOnCtrlC: false` to `render()`:

```typescript
render(
  React.createElement(App, { ... }),
  { exitOnCtrlC: false }
);
```

**Step 2: Handle Ctrl+C in `app.tsx`**

Add state and logic to the App component:

```typescript
const [ctrlCPending, setCtrlCPending] = useState(false);
const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

In the `useInput` handler (which runs for ALL key events, including from TextInput):

```typescript
if (key.ctrl && input === "c") {
  // If agent is busy, abort it (same as Esc)
  if (busy && abortRef.current) {
    abortRef.current.abort();
    addSystemMessage("Interrupting agent...");
    return;
  }

  if (ctrlCPending) {
    // Second Ctrl+C within window → exit
    app.exit();
    return;
  }

  // First Ctrl+C → start the 3s window
  setCtrlCPending(true);
  addSystemMessage("Press Ctrl+C again to exit.");
  ctrlCTimerRef.current = setTimeout(() => {
    setCtrlCPending(false);
  }, 3000);
  return;
}
```

Clean up the timer on unmount:

```typescript
useEffect(() => {
  return () => {
    if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
  };
}, []);
```

**Step 3: Update `text-input.tsx`**

Remove the Ctrl+C pass-through early return so the event bubbles to the app-level `useInput`:

```typescript
// Before:
if ((key.ctrl && input === "c") || (key.shift && key.tab)) {
  return;
}

// After:
if (key.shift && key.tab) {
  return;
}
```

Note: Ink's `useInput` hooks fire in component tree order. The app-level `useInput` and the TextInput-level `useInput` both fire for every key event. Since Ink's built-in Ctrl+C handling is disabled, the event will reach both handlers. The app-level handler should process Ctrl+C; the TextInput handler should ignore it (which it already does via early return — but now it needs to NOT consume it so the app handler also runs). Actually, since both `useInput` hooks fire independently for the same event, both will see Ctrl+C. The TextInput should simply do nothing (return early), and the app handler handles the exit logic.

### Files to modify

- `src/cli.ts` — add `exitOnCtrlC: false` to render options
- `src/tui/app.tsx` — add double-tap Ctrl+C state, timer, and handler logic
- `src/tui/text-input.tsx` — keep the Ctrl+C early return (no change needed since both handlers fire independently)

### Edge cases

- **Ctrl+C while agent question is pending** — should abort the question, not trigger exit
- **Ctrl+C while config/resume screen is open** — should close the screen (like Esc), not trigger exit
- **Multiple rapid Ctrl+C** — the second one within 3s exits regardless of how many were pressed
- **Timer cleanup** — clear the 3s timeout if the component unmounts or the user navigates away
