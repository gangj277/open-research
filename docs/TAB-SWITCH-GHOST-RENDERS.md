# Bug: Ghost Duplicate Renders on Terminal Tab Switch

## Symptom

When the user switches to another terminal tab and returns, duplicate/ghost copies of the input area appear stacked vertically with broken box-drawing characters. Each tab-switch cycle adds another ghost. Conversation content renders correctly — only the dynamic (non-Static) area duplicates.

## Root Cause

A compound interaction of three factors in the Ink rendering pipeline.

### Factor 1 (Primary): `<Static>` key includes `toolActivityExpanded`

**File:** `src/tui/app.tsx`, line 968

```tsx
<Static key={`conversation-static-${messageRenderVersion}-${toolActivityExpanded ? "e" : "c"}`} items={staticMessages}>
```

When the `key` changes (e.g., user presses Ctrl+O), React unmounts and remounts the `<Static>` component. On remount, Ink's Static component resets its internal index to 0 and re-renders ALL items from scratch. Every re-render gets **appended** to Ink's internal `fullStaticOutput` string (ink.js line 316) — which is append-only and never shrinks.

On the next fullscreen re-render (triggered by resize), Ink writes `clearTerminal + fullStaticOutput + output` — emitting all the duplicated content.

### Factor 2 (Amplifier): Ink's resize handler resets render state

**File:** `node_modules/ink/build/ink.js`, lines 204-215

When the terminal width decreases (happens when tab is backgrounded — some terminals report columns=0), Ink's `resized()` handler:
1. Calls `this.log.clear()`
2. Resets `lastOutput = ''` and `lastOutputToRender = ''`
3. Calls `calculateLayout()` + `onRender()`

When the user returns to the tab, width restores → another resize → another `onRender()`. Since `lastOutput` was cleared during the decrease phase, the `output !== this.lastOutput` check is true, forcing a full re-write including all accumulated `fullStaticOutput`.

### Factor 3 (Amplifier): `useEffect` without dependency array in text-input

**File:** `src/tui/text-input.tsx`, lines 229-243

```typescript
useEffect(() => {
  // ... measureElement logic
  const measuredWidth = measureElement(containerRef.current).width;
  // ... setInputWidth if changed
}); // <-- NO DEPENDENCY ARRAY: runs every render
```

During resize transitions, `measureElement` returns different values, triggering `setInputWidth()` state updates, creating extra re-render cycles that compound the problem.

## Causal Chain

```
Terminal tab switch away
  → stdout resize event (columns = 0 or changed)
    → Ink resized(): lastOutput reset to '', onRender() called
    → useTerminalWidth hook: setTerminalWidth() triggers re-render
    → text-input useEffect (no deps): measureElement → setInputWidth → another re-render

Terminal tab return
  → stdout resize event (columns restored to real value)
    → Ink resized(): onRender() fires
      → lastOutput is '' (was cleared), so output !== lastOutput = true
      → Fullscreen path: writes clearTerminal + fullStaticOutput + output
        → fullStaticOutput has accumulated duplicates from past <Static> remounts
        → Ghost copies appear
    → useTerminalWidth: another state update → another re-render cycle
```

## Fix (Priority Order)

### Fix 1 — Remove `toolActivityExpanded` from `<Static>` key (CRITICAL)

**File:** `src/tui/app.tsx`, line 968

Change:
```tsx
<Static key={`conversation-static-${messageRenderVersion}-${toolActivityExpanded ? "e" : "c"}`} items={staticMessages}>
```

To:
```tsx
<Static key={`conversation-static-${messageRenderVersion}`} items={staticMessages}>
```

The `toolActivityExpanded` flag is already passed to `renderConversationMessage` as a parameter (line 969). It does NOT need to be in the key. The key should only change when the conversation history needs a full reset (session resume, `/clear`), which is what `messageRenderVersion` handles.

This is the single most impactful fix. It prevents `<Static>` from remounting and re-emitting all items into `fullStaticOutput`.

### Fix 2 — Add dependency array to text-input `useEffect` (IMPORTANT)

**File:** `src/tui/text-input.tsx`, lines 229-243

Change the bare `useEffect(() => { ... })` to:
```typescript
useEffect(() => {
  // ... measureElement logic
}, [originalValue, focus]);
```

Or at minimum, debounce the measurement so it doesn't fire on every single render during resize transitions.

### Fix 3 — Debounce resize handler (DEFENSIVE)

**File:** `src/tui/hooks/use-terminal-width.ts`

Add a debounce (50-100ms) to the resize event handler to prevent rapid-fire state updates during tab-switch bounce:

```typescript
const updateWidth = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const nextWidth = getObservedTerminalWidth(stream.columns, process.stdout.columns);
    setTerminalWidth((current) => current === nextWidth ? current : nextWidth);
  }, 50);
};
```

This prevents the width from bouncing between 0 and the real value, which triggers multiple re-render cycles.

### Fix 4 — Guard against columns=0 (DEFENSIVE)

**File:** `src/tui/hooks/use-terminal-width.ts` or `src/tui/layout.ts`

When the terminal reports `columns = 0` (backgrounded tab), ignore the resize event entirely:

```typescript
const updateWidth = () => {
  const cols = stream.columns ?? process.stdout.columns ?? 0;
  if (cols === 0) return; // backgrounded tab, ignore
  // ... proceed with update
};
```

## Relevant Files

| File | Lines | Issue |
|------|-------|-------|
| `src/tui/app.tsx` | 968 | `<Static>` key includes `toolActivityExpanded` — causes remount |
| `src/tui/text-input.tsx` | 229-243 | `useEffect` without deps — cascading re-renders |
| `src/tui/hooks/use-terminal-width.ts` | 11-26 | No debounce on resize → rapid state updates |
| `node_modules/ink/build/ink.js` | 204-215, 315-356 | Ink resets lastOutput on resize, fullStaticOutput is append-only |

## Verification

After applying fixes:
1. Run `npm run dev`
2. Start a conversation so messages appear
3. Switch to another terminal tab, wait 2 seconds, switch back
4. Repeat 5 times
5. Verify: no ghost copies, no broken box characters, layout is clean
6. Press Ctrl+O to toggle tool expansion — verify no ghost copies after toggle
