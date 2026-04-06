# Paste Input Bug — Text Clipping on Paste

## Summary

When a user copies multi-line text and pastes it into the Open Research CLI prompt, the beginning of the pasted text is clipped/truncated. Only the tail end of the pasted content appears in the input field. The original text is not preserved.

**Severity:** High — breaks a core input workflow.

## How to Reproduce

1. Copy any multi-line text to the clipboard (e.g., a paragraph from a browser or editor).
2. Open the CLI: `npm run dev`
3. Paste into the prompt (Cmd+V on macOS).
4. **Observed:** Only the last portion of the pasted text appears. The beginning is lost.
5. **Expected:** The full pasted text appears in the input (or is collapsed into a `[Pasted text #N +M lines]` badge with the full content preserved internally).

## Screenshot

The prompt shows `>ng the entire pasted result or text. I'll show you...` — the beginning of the sentence is missing. The user pasted a full paragraph but only the tail was captured.

## Root Cause Analysis

The bug is **not in our TextInput component**. It originates in **how Ink (the React terminal framework) processes raw stdin data** before our handler ever sees it.

### The pipeline

```
Terminal stdin (raw bytes)
  → Ink's input-parser.js: splits raw bytes into "events" (individual keypresses / sequences)
  → Ink's App.js: emits each event on internal_eventEmitter
  → Ink's use-input.js: calls parseKeypress() on each event, then calls our handler
  → Our text-input.tsx useInput() handler: receives (input, key) and updates state
```

### Where the data is lost

**Step 1 — Ink's `input-parser.js`** splits the raw stdin chunk into events. For pasted text, it looks for escape sequences (`\x1b`) and splits around them. Plain text between escape sequences becomes one event. This part works correctly for simple pastes.

**Step 2 — Bracketed Paste Mode.** Modern terminals (iTerm2, Terminal.app, Ghostty, etc.) enable **bracketed paste mode** when stdin is in raw mode. They wrap pasted text in escape sequences:

```
\x1b[200~   <pasted content>   \x1b[201~
```

Ink does **not** understand bracketed paste mode. It has no handler for `[200~` / `[201~`. These sequences are:

1. Parsed as unknown CSI function-key events by `parseKeypress()`
2. Fed to `use-input.js` which passes them through as `input = "[200~"` (after stripping the leading ESC)
3. Our handler receives `"[200~"` as regular text input

**Step 3 — The actual data loss.** When the terminal sends the bracketed paste as a single large chunk, `input-parser.js` splits it into multiple events:

```
Event 1: "\x1b[200~"          → bracket-open marker (garbled)
Event 2: "first part of text" → possibly split further if it contains escape-like bytes
Event 3: "rest of text"       → another fragment
Event 4: "\x1b[201~"          → bracket-close marker (garbled)
```

However, when the pasted content is large, **Node.js may deliver the data across multiple `readable` events** on stdin. Each `readable` event triggers Ink's `handleReadable()` which calls `inputParserRef.current.push(chunk)`. If the paste is split mid-content across chunks, and the first chunk ends near an escape sequence boundary, the input parser may hold back data as "pending" or misparse it.

Additionally, **Ink's `parseKeypress()` only returns a single keypress result per call** — it doesn't handle multi-character strings as "paste". When `use-input.js` receives a multi-char event, it passes the entire string to the handler — but the `key` object (ctrl, meta, shift, etc.) is derived from single-character parsing logic. For multi-char input:

- The string doesn't match any special key pattern (not `\r`, `\t`, single char, etc.)
- Falls through to the default case with `key.name = ''`
- `input = keypress.sequence` which is the raw multi-char string
- If the string starts with `\x1b` (common in bracketed paste fragments), `use-input.js` **strips the leading ESC**: `input = input.slice(1)` — this corrupts the data

**This ESC-stripping on line 101-103 of `use-input.js` is the primary cause of data loss:**

```javascript
// use-input.js line 99-103
if (input.startsWith('\u001B')) {
    input = input.slice(1);
}
```

If a paste chunk happens to start with an escape character (which is guaranteed for the `\x1b[200~` marker, and possible for content fragments after chunk splitting), the first character after the ESC is silently dropped.

### Why Claude Code doesn't have this problem

Claude Code uses a custom stdin handler that:
1. Detects bracketed paste mode (`\x1b[200~` ... `\x1b[201~`) and buffers the entire paste as a single unit
2. Does not use Ink's `useInput` for paste handling — it reads stdin directly with paste-aware parsing
3. Handles large pastes by accumulating chunks until the closing `\x1b[201~` is seen

## Possible Fixes

### Option A: Intercept stdin before Ink (Recommended)

Add a custom stdin transform layer that:
1. Detects `\x1b[200~` (bracketed paste start)
2. Buffers all data until `\x1b[201~` (bracketed paste end)
3. Strips the markers and emits the content as a single clean event
4. Bypasses Ink's input parser for pasted content entirely

This would be implemented as a `Transform` stream wrapping `process.stdin` before passing it to Ink's `render()`, or by hooking into Ink's internal event emitter directly.

```typescript
// Pseudo-code
class BracketedPasteTransform extends Transform {
  private pasteBuffer: string = "";
  private inPaste = false;

  _transform(chunk, encoding, callback) {
    const data = chunk.toString();
    // detect \x1b[200~ → start buffering
    // detect \x1b[201~ → flush buffer as single paste event
    // outside paste → pass through normally
  }
}
```

### Option B: Disable bracketed paste mode

Write `\x1b[?2004l` to stdout when the app starts to tell the terminal not to use bracketed paste. This means pasted text arrives as raw keystrokes — but this causes its own problems (e.g., pasted newlines would trigger Enter/submit).

### Option C: Patch Ink's input parser

Fork or monkey-patch `input-parser.js` to recognize `[200~`/`[201~` sequences and handle them as paste boundaries. This is the most correct fix but requires maintaining a fork of Ink.

## Recommendation

**Option A** is the best path forward. It's non-invasive (doesn't require forking Ink), handles all terminal types, and can be implemented as a self-contained module. The key requirement is that the paste interceptor must buffer across multiple Node.js `readable` events, since large pastes will arrive in chunks.

## Files Involved

- `node_modules/ink/build/input-parser.js` — splits stdin into events, no paste awareness
- `node_modules/ink/build/hooks/use-input.js` — line 101: strips leading ESC from input, causing data loss
- `node_modules/ink/build/parse-keypress.js` — single-keypress parser, doesn't handle multi-char paste
- `node_modules/ink/build/components/App.js` — `handleReadable()` processes stdin chunks
- `src/tui/text-input.tsx` — our input handler, receives already-corrupted data
- `src/cli.ts` — where `render()` is called, place to inject stdin transform
