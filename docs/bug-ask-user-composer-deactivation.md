# Bug: Chat Input Deactivation After ask_user Completion

**Severity:** High (UX-breaking)  
**Date:** 2026-04-07  
**Status:** Open  
**Affected area:** TUI composer focus management, ask_user tool flow

---

## Symptom

After an agent `ask_user` question is answered and the agent turn completes, the **chat input (TextInput) becomes visually inactivated** — no cursor, no placeholder change, appears unresponsive ("don't show anything"). The entire composer area looks dead.

However, if the user types any character + Enter, the message sends successfully and the composer snaps back to normal. This creates an extremely jarring, glitchy experience after every ask_user interaction.

---

## How the ask_user System Works

The ask_user tool uses a module-level queue pattern (documented in CLAUDE.md):

```
Agent runtime                          TUI (Ink/React)
───────────────                        ─────────────────
executeAskUser() called
  push question → pendingQuestions[]
  await Promise (blocks agent loop)
                                       Polling effect (200ms interval)
                                         getPendingQuestion() → finds question
                                         setAgentQuestion(q)
                                         setComposerFocused(false)
                                       QuestionCard renders (active=true)
                                       User picks an option → onSelect fires:
                                         resolve() — unblocks agent Promise
                                         clearPendingQuestion() — shifts queue
                                         setAgentQuestion(null)
                                         setComposerFocused(true)
executeAskUser returns answer
Agent continues → more tools → finish
finally block:
  setBusy(false)
  setComposerFocused(true)
                                       Polling effect cleanup
                                       Composer should be active ← BUG: it isn't
```

---

## Root Cause: `startTransition` Splits the State Commit

The primary bug is a **React state commit ordering issue** caused by `startTransition` on line 781 of `app.tsx`.

### The Race

After the user answers a question, the agent continues running and may produce **proposed updates** (file edits for user review). These are committed to state via `startTransition`:

```typescript
// app.tsx:780-782 — inside sendToAgent(), AFTER agent runtime returns
if (reviewRequired.length > 0) {
  startTransition(() => setPendingUpdates((c) => [...c, ...reviewRequired]));
}
```

The `finally` block (lines 813-819) uses **urgent (non-transition)** state updates:

```typescript
finally {
  setBusy(false);           // urgent
  setComposerFocused(true); // urgent
}
```

React processes urgent updates BEFORE transitions. This creates a two-phase commit:

**Phase 1 — Urgent commit:**
- `busy = false`, `composerFocused = true`
- Auto-defocus effect (lines 199-208) runs:
  - `!busy` = true, `pendingUpdates.length` = 0 (transition hasn't committed), `prevCount` = 0
  - `0 > 0` = false -> no defocus (good)
  - **But `prevPendingCountRef.current` is set to 0** <- the setup for the bug

**Phase 2 — Transition commit:**
- `pendingUpdates = [...reviewRequired]` (length becomes N)
- Auto-defocus effect runs AGAIN:
  - `!busy` = true, `pendingUpdates.length` = N, `prevCount` = 0
  - **`N > 0` = true -> `setComposerFocused(false)`** <- BUG

The auto-defocus effect at lines 199-208:
```typescript
useEffect(() => {
  const prevCount = prevPendingCountRef.current;
  if (!busy && pendingUpdates.length > prevCount && pendingUpdates.length > 0 && !agentQuestion) {
    setComposerFocused(false);  // <-- fires in Phase 2, overriding the true from finally
  }
  prevPendingCountRef.current = pendingUpdates.length;
}, [pendingUpdates.length, busy, agentQuestion]);
```

### Why "don't show anything"

There's a second-order timing issue. The PendingUpdateCard renders based on `deferredPendingUpdates`:

```tsx
// app.tsx:1050
{deferredPendingUpdates.length > 0 && (
  <PendingUpdateCard ... />
)}
```

`deferredPendingUpdates` is `useDeferredValue(pendingUpdates)` (line 135). It lags behind `pendingUpdates` by one render. So there's a brief window where:

| State | Value |
|-------|-------|
| `composerFocused` | `false` (from effect) |
| `agentQuestion` | `null` (answered) |
| `pendingUpdates.length` | N (transition committed) |
| `deferredPendingUpdates.length` | 0 (lagging) |

In this window:
- TextInput has `focus=false` -> inactive, no cursor shown
- QuestionCard not rendered (`agentQuestion` is null)
- PendingUpdateCard not rendered (`deferredPendingUpdates.length` is 0)
- **Nothing interactive is visible** -> "don't show anything to user"

### Why typing restores it

The global `useInput` handler (lines 568-584) has a fallback re-focus mechanism:

```typescript
if (!composerFocused) {
  // Guard: if pending updates or question exist, let their cards handle input
  if ((pendingUpdates.length > 0 && !agentQuestion) || agentQuestion) return;  // line 579

  // Fallback: any character key re-focuses the composer
  if (key === "i" || (key.length === 1 && !inputKey.ctrl && !inputKey.meta && !inputKey.tab)) {
    setComposerFocused(true);      // re-activates composer
    if (key !== "i") setInput((c) => c + key);  // types the character
    return;
  }
}
```

Once `pendingUpdates.length > 0` (line 579), this guard blocks the fallback. But if pending updates are accepted/rejected (reducing length to 0), OR during the brief `deferredPendingUpdates` lag window where `pendingUpdates` might not yet be visible, the fallback triggers.

---

## Secondary Issue: Polling Interval Stale Closure

The polling effect (lines 182-197) creates a `setInterval` with a closure over `agentQuestion`:

```typescript
useEffect(() => {
  if (!busy) { setAgentQuestion(null); return; }
  const interval = setInterval(() => {
    const pending = getPendingQuestion();
    if (pending && (!agentQuestion || pending.question.id !== agentQuestion.question.id)) {
      setAgentQuestion(pending);
      setComposerFocused(false);     // <-- can fire with stale closure
    }
  }, 200);
  return () => clearInterval(interval);
}, [busy, agentQuestion]);
```

When the user answers and `setAgentQuestion(null)` is queued, the interval from the previous effect run is still alive for up to 200ms. If the `executeAskUser` `for` loop pushes the next batched question to the module-level queue in between (via microtask after `resolve()`), the stale interval can detect it and call `setComposerFocused(false)` — potentially racing with the `setComposerFocused(true)` from `onSelect`.

---

## Affected Code Locations

| File | Lines | Role |
|------|-------|------|
| `src/tui/app.tsx` | 99 | `composerFocused` state declaration |
| `src/tui/app.tsx` | 182–197 | Polling effect — detects questions, defocuses composer |
| `src/tui/app.tsx` | 199–208 | **Auto-defocus effect** — the primary bug trigger |
| `src/tui/app.tsx` | 568–584 | Global `useInput` fallback that re-enables focus on keypress |
| `src/tui/app.tsx` | 780–782 | `startTransition(() => setPendingUpdates(...))` — defers the state update |
| `src/tui/app.tsx` | 813–819 | `finally` block — `setBusy(false)`, `setComposerFocused(true)` (urgent) |
| `src/tui/app.tsx` | 1104–1128 | QuestionCard render + onSelect callback |
| `src/tui/app.tsx` | 1050–1068 | PendingUpdateCard render (uses `deferredPendingUpdates`) |
| `src/tui/text-input.tsx` | 590 | `useInput({ isActive: focus })` — TextInput goes inactive when `focus=false` |
| `src/tui/components.tsx` | 515–672 | QuestionCard — `useInput` with `isActive: active` |
| `src/lib/agent/tools/ask-user.ts` | 12–24 | Module-level `pendingQuestions` queue |
| `src/lib/agent/tools/ask-user.ts` | 62–113 | `executeAskUser` — sequential question loop with `await` |

---

## Reproduction Steps

1. Start the TUI, open a workspace
2. Send a message that triggers the agent to call `ask_user` (e.g., an ambiguous research question)
3. Wait for the QuestionCard to appear
4. Select an answer (arrow keys + Enter, or type a custom answer)
5. Wait for the agent to finish its turn (the agent should produce at least one proposed file update to reliably trigger the bug)
6. **Observe:** The composer area appears dead — no cursor, no active placeholder, no visible interactive element
7. Press any character key — composer snaps back, the character appears in input
8. Press Enter — message sends, normal operation resumes

---

## Suggested Fixes

### Fix 1 (Primary): Move `setPendingUpdates` out of `startTransition`

The simplest fix is to make the pending updates commit happen in the same urgent batch as `setBusy(false)`:

```typescript
// app.tsx — move setPendingUpdates to the finally block or out of startTransition
if (reviewRequired.length > 0) {
  setPendingUpdates((c) => [...c, ...reviewRequired]);  // urgent, not transition
}
```

This ensures the auto-defocus effect sees the correct `pendingUpdates.length` in the same render cycle as `busy=false`, and the `prevPendingCountRef` tracks it correctly.

**Trade-off:** Removes the transition optimization for pending update state changes (slightly less smooth rendering for large update batches, but eliminates the race).

### Fix 2 (Alternative): Guard the auto-defocus effect against the finally-block window

Add a flag that prevents the auto-defocus effect from firing immediately after the agent turn ends:

```typescript
// In sendToAgent's finally block:
finally {
  setBusy(false);
  setComposerFocused(true);
  // Skip auto-defocus for one render cycle to let pending updates settle
  suppressAutoDefocusRef.current = true;
  requestAnimationFrame(() => { suppressAutoDefocusRef.current = false; });
}

// In the auto-defocus effect:
useEffect(() => {
  if (suppressAutoDefocusRef.current) {
    prevPendingCountRef.current = pendingUpdates.length;
    return;
  }
  // ... existing logic
}, [pendingUpdates.length, busy, agentQuestion]);
```

### Fix 3 (Polling hardening): Add a debounce/guard to the polling interval

Prevent the polling interval from setting `composerFocused=false` when the question was just answered:

```typescript
useEffect(() => {
  if (!busy) { setAgentQuestion(null); return; }
  const interval = setInterval(() => {
    const pending = getPendingQuestion();
    if (pending && (!agentQuestion || pending.question.id !== agentQuestion.question.id)) {
      setAgentQuestion(pending);
      setComposerFocused(false);
    }
  }, 200);
  return () => clearInterval(interval);
}, [busy, agentQuestion]);
```

Consider replacing the polling pattern with a callback/event-based approach so the TUI is notified immediately when a question is enqueued, rather than relying on a 200ms poll that can race with React state updates.

### Fix 4 (Belt-and-suspenders): Ensure PendingUpdateCard and auto-defocus use the same value

Both the render check and the effect should use the same source of truth. Currently:
- Auto-defocus effect uses `pendingUpdates` (urgent)
- PendingUpdateCard render uses `deferredPendingUpdates` (deferred)

This mismatch creates the "nothing visible" window. Either both should use deferred or both should use urgent.

---

## Impact

Every ask_user interaction that is followed by proposed file updates (which is the common case — the agent answers a clarification question then proposes edits) triggers this bug. The user sees a dead input area for at least one render cycle, and often longer until they manually interact. This makes the ask_user feature feel broken.
