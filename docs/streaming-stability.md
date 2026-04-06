# Streaming UX — Auto-Scroll & Sentence-Level Buffering

## Problems

### 1. Auto-scroll during streaming

When the agent streams a long response, Ink re-renders the full output on every token. Since Ink uses a log-update approach (rewriting the terminal from the top), each re-render causes the terminal viewport to jump to the bottom. This makes the screen flicker and prevents the user from scrolling up to read earlier parts of the conversation while the agent is still streaming.

**Impact:** The user cannot review previous messages or context while the agent is working. The terminal constantly snaps to the bottom on every render cycle.

### 2. Token-by-token re-renders cause instability

Currently, `onTextDelta` fires for every token (often 1-3 characters). Each token triggers a React state update via `startTransition(() => setMessages(...))`. Even with `startTransition`, this means:

- Dozens of state updates per second during streaming
- Each update triggers a full Ink re-render cycle (layout + paint)
- Terminal output flickers as partial words appear and get rewritten
- On slower terminals or large conversations, this causes visible lag and jank

**Impact:** The streaming feels jittery rather than smooth. Words appear character-by-character instead of flowing naturally.

## Desired Behavior

1. **No forced scroll** — the terminal should not jump to the bottom on every render. The user should be able to scroll freely. New content appears at the bottom but doesn't yank the viewport.

2. **Sentence-level streaming** — instead of updating the UI on every token, buffer incoming tokens and flush to the UI at natural boundaries (end of sentence, newline, or a time threshold). This produces a smooth, readable flow similar to how ChatGPT renders text.

## Implementation

### Sentence-level buffering

Add a streaming buffer in `sendToAgent()` that accumulates tokens and flushes at sentence boundaries:

```typescript
// In sendToAgent(), before the runAgentTurn call:
let streamBuffer = "";
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushBuffer() {
  if (!streamBuffer) return;
  const flushed = streamBuffer;
  streamBuffer = "";
  startTransition(() => {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") {
        next.push({ role: "assistant", text: flushed });
      } else {
        last.text += flushed;
      }
      return next;
    });
  });
}

// Sentence-ending patterns: period/question/exclamation followed by space or newline, 
// or a newline character, or markdown heading/list markers
const FLUSH_PATTERN = /[.!?]\s|\n|^#{1,3}\s|^[-*]\s/m;
const FLUSH_INTERVAL_MS = 80; // max time before flushing regardless
```

Then in the `onTextDelta` callback:

```typescript
onTextDelta: (chunk) => {
  assistantText += chunk;
  streamBuffer += chunk;

  // Flush at sentence boundaries
  if (FLUSH_PATTERN.test(streamBuffer)) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    flushBuffer();
    return;
  }

  // Fallback: flush after FLUSH_INTERVAL_MS even without a boundary
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushBuffer();
    }, FLUSH_INTERVAL_MS);
  }
},
```

After `runAgentTurn` completes, flush any remaining buffer:

```typescript
// After await runAgentTurn(...)
if (flushTimer) clearTimeout(flushTimer);
flushBuffer();
```

### Auto-scroll prevention

This is harder to solve because Ink fundamentally re-renders by clearing and rewriting the visible portion of the terminal. Ink does not support virtual scrolling or partial updates.

**Option A: Limit visible messages during streaming**

Instead of rendering all messages, only render the last N messages (e.g., last 5) while `busy === true`. This keeps the render area small and prevents viewport jumping:

```typescript
const visibleMessages = busy 
  ? deferredMessages.slice(-5) 
  : deferredMessages.slice(-50);
```

This doesn't truly prevent scrolling issues but reduces the render area so jumps are less disruptive.

**Option B: Use Ink's `<Static>` component**

Ink provides a `<Static>` component for content that, once rendered, is never re-rendered. Move completed messages into `<Static>` and only keep the currently-streaming message in the dynamic render area:

```tsx
import { Static } from "ink";

// Split messages: all except the last (streaming) one go into Static
const staticMessages = busy ? messages.slice(0, -1) : messages;
const dynamicMessages = busy ? messages.slice(-1) : [];

<Static items={staticMessages}>
  {(msg, idx) => <MessageComponent key={idx} msg={msg} />}
</Static>

{dynamicMessages.map((msg, idx) => (
  <MessageComponent key={`dynamic-${idx}`} msg={msg} />
))}
```

With `<Static>`, completed messages are written once and never touched again. Only the streaming message at the bottom gets re-rendered. This eliminates viewport jumping entirely.

**Recommendation:** Option B (`<Static>`) is the correct solution. It's what Ink was designed for. The main caveat is that items in `<Static>` cannot be updated — so we must be careful to only move messages there once they are finalized.

### Files to modify

- `src/tui/app.tsx` — add stream buffer logic in `sendToAgent()`, refactor message rendering to use `<Static>` for finalized messages
- No changes needed in `runtime.ts` or `text-input.tsx`

### Testing

- Stream a long response → text should appear in sentence-sized chunks, not character-by-character
- During streaming, scroll up in the terminal → viewport should not snap back down
- Short responses (single sentence) should still appear promptly due to the 80ms fallback timer
- Tool activity messages between streaming chunks should flush the buffer before appearing
