# Auto-Scroll During Streaming — Users Can't Scroll Up

## Problem

When the agent is thinking/streaming, the terminal auto-scrolls to the bottom on every text update. Users cannot scroll up to review earlier messages or tool output while the agent is actively responding. This is a significant UX regression — especially during long multi-tool turns where the user needs to reference earlier output.

## Root Cause

Three factors combine to create this behavior:

### 1. Ink's Full-Screen Repaint Model

The TUI is built on **Ink v6** (React for terminal). Ink re-renders the **entire component tree** on every React state update — it clears the terminal and repaints from scratch rather than doing incremental line updates.

### 2. The `rows = 0` Proxy in `ink-stdout.ts`

`src/tui/ink-stdout.ts` wraps stdout with a Proxy that returns `rows = 0`:

```typescript
if (prop === "rows") {
  return 0; // Force Ink's full-clear redraw path
}
```

This forces Ink to use its full-clear redraw path (instead of relative cursor movement). While more robust for long-lived TUIs, it **wipes the terminal scrollback buffer on every render**.

### 3. High-Frequency State Updates During Streaming

The streaming pipeline triggers React state updates every ~80ms:

```
LLM token → onTextDelta (app.tsx:685)
  → streamBuffer.push() (streaming.ts)
    → flushes on sentence boundary or 80ms timeout
      → addAssistantMessage() (app.tsx:332)
        → setMessages() via startTransition
          → Ink full repaint → terminal cleared → scroll position lost
```

Each `setMessages` call triggers a React re-render. With `useDeferredValue(messages)` batching, this still results in multiple full terminal repaints per second.

## The Scroll-Killing Cycle

1. User scrolls up to read earlier output
2. ~80ms later, a sentence flush triggers `setMessages()`
3. React re-renders, Ink clears the terminal and repaints
4. Terminal scrollback is destroyed, viewport jumps to bottom
5. User's scroll position is lost

## Affected Components

| File | Role |
|------|------|
| `src/tui/ink-stdout.ts` | Forces full-clear redraw via `rows = 0` |
| `src/tui/streaming.ts` | Sentence buffer flushes every 80ms during streaming |
| `src/tui/app.tsx:332-345` | `addAssistantMessage()` triggers `setMessages()` |
| `src/tui/app.tsx:135` | `useDeferredValue(messages)` batches but doesn't prevent repaints |
| `src/tui/app.tsx:147-150` | `renderedMessages` recomputes on every deferred update |

## Possible Solutions

### A. Use Ink's `<Static>` component for completed messages

Ink provides a `<Static>` component that renders items **once** into the scrollback buffer and never re-renders them. Only the dynamic portion (current streaming message, input, footer) would re-render.

```tsx
import { Static } from "ink";

// Completed messages — written once to scrollback, never cleared
<Static items={completedMessages}>
  {(msg, i) => <MessageComponent key={i} message={msg} />}
</Static>

// Only the active streaming portion re-renders
<Box>{currentStreamingMessage}</Box>
```

**Note:** The codebase previously imported `Static` from Ink but it was removed. Re-introducing it would be the most architecturally sound fix.

**Trade-off:** `<Static>` items cannot be updated after render (no expanding/collapsing tool summaries for past messages).

### B. Reduce repaint frequency during streaming

Increase the flush interval or batch more aggressively to reduce the number of full repaints:

- Increase `STREAM_FLUSH_INTERVAL_MS` from 80ms to 200-300ms
- Only trigger `setMessages` on paragraph boundaries instead of sentences
- Use a ref to accumulate text and only commit to state at larger intervals

**Trade-off:** Makes streaming feel less responsive/smooth.

### C. Remove the `rows = 0` hack

Letting Ink use its default relative-cursor rendering would preserve scrollback. The comment in `ink-stdout.ts` explains this was added for robustness when backgrounding/restoring the TUI.

**Trade-off:** May reintroduce rendering glitches on terminal resize or background/foreground.

### D. Hybrid: Static scrollback + dynamic viewport

Split the render into two zones:
1. **Scrollback zone** (via `<Static>`) — all completed messages plus tool output
2. **Dynamic zone** — only the currently-streaming message, pending update card, input composer, and footer

When a message finishes streaming, move it from the dynamic zone to the static zone. This preserves scrollback for completed content while keeping the active portion responsive.

## Recommended Approach

**Option D (Hybrid)** is the most robust. It matches how tools like Claude Code handle this — completed output stays in scrollback and is scrollable, while only the active area re-renders. This requires:

1. Track which messages are "complete" vs "streaming"
2. Render complete messages with `<Static>`
3. Keep only the active streaming message + UI chrome in the dynamic render
4. On stream completion, graduate the message to static

## Impact

- **Severity:** High — affects every streaming interaction
- **User segments:** All users in manual-review and auto-research modes
- **Frequency:** Every agent turn with any streaming output
