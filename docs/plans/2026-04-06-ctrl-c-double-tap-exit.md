# Ctrl+C Double-Tap Exit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent accidental CLI termination by requiring a second idle `Ctrl+C` within 3 seconds to exit, while preserving interrupt behavior when the agent is busy or an overlay screen is open.

**Architecture:** Disable Ink's built-in `Ctrl+C` shutdown in the CLI bootstrap so key events reach the app. Centralize the new decision tree in the app-level `useInput` handler, where we already manage `Esc`, busy aborts, and top-level screen transitions. Cover the behavior with focused TUI and CLI tests so the input contract stays stable.

**Tech Stack:** TypeScript, React 19, Ink 6, ink-testing-library, Vitest

---

### Task 1: Capture the desired behavior in tests

**Files:**
- Create: `tests/tui/ctrl-c.test.tsx`
- Create: `tests/cli/render-options.test.ts`
- Check: `src/tui/app.tsx`
- Check: `src/cli.ts`

**Step 1: Write the failing TUI tests**

Add tests for:
- first idle `Ctrl+C` shows `Press Ctrl+C again to exit.`
- warning clears after 3 seconds without exiting
- second idle `Ctrl+C` within the window calls `app.exit()`
- `Ctrl+C` while busy aborts the running turn instead of exiting
- `Ctrl+C` while `/config` is open closes the overlay instead of exiting

**Step 2: Run the targeted TUI tests to verify they fail**

Run: `npm test -- tests/tui/ctrl-c.test.tsx`
Expected: FAIL because idle `Ctrl+C` is not handled by `App` yet

**Step 3: Write the failing CLI test**

Assert that the top-level `render()` call includes `{ exitOnCtrlC: false }`.

**Step 4: Run the targeted CLI test to verify it fails**

Run: `npm test -- tests/cli/render-options.test.ts`
Expected: FAIL because `src/cli.ts` does not currently pass the render option

### Task 2: Implement the app-level Ctrl+C flow

**Files:**
- Modify: `src/tui/app.tsx`

**Step 1: Add pending-exit state and timer refs**

Introduce:
- `ctrlCPending` state
- `ctrlCTimerRef`

**Step 2: Add a reset helper**

Implement a helper that clears any active timer and resets pending state. Use it whenever the window expires or the app transitions away from the exit flow.

**Step 3: Extend the app-level `useInput` handler**

Handle `Ctrl+C` in this order:
- if busy and abort controller exists: abort and show interrupt system message
- if a non-main screen is open: close it and restore composer focus
- if `ctrlCPending` is already true: exit the app
- otherwise set `ctrlCPending`, show `Press Ctrl+C again to exit.`, and start a 3 second timeout that clears the pending state

**Step 4: Clean up on unmount**

Add an effect cleanup that clears the timer.

**Step 5: Keep the flow tidy**

Reset the pending exit window when appropriate so a stale timer does not leak across interactions.

### Task 3: Disable Ink's built-in Ctrl+C exit

**Files:**
- Modify: `src/cli.ts`

**Step 1: Update the CLI render options**

Pass:

```typescript
render(React.createElement(App, { ... }), { exitOnCtrlC: false });
```

**Step 2: Leave text input alone unless tests prove otherwise**

The current `TextInput` already ignores `Ctrl+C`. Because Ink hooks fire independently, only change `src/tui/text-input.tsx` if the new tests show an actual conflict.

### Task 4: Verify and polish

**Files:**
- Check: `tests/tui/ctrl-c.test.tsx`
- Check: `tests/cli/render-options.test.ts`
- Check: `src/tui/app.tsx`
- Check: `src/cli.ts`

**Step 1: Run the focused suite**

Run: `npm test -- tests/tui/ctrl-c.test.tsx tests/cli/render-options.test.ts`
Expected: PASS

**Step 2: Run the existing nearby regression tests**

Run: `npm test -- tests/tui/app.test.tsx tests/tui/text-input.test.tsx`
Expected: PASS

**Step 3: Run the full test suite if time allows**

Run: `npm test`
Expected: PASS
