# TUI Layout Issues: Root Cause Analysis & Fix Plan

## Problem

The CLI chat interface frequently breaks its layout — text overflows horizontally, elements get clipped at the right edge, agent labels split across lines, and components don't respect terminal width. This happens because **almost no component in the render tree constrains its width to the terminal**.

---

## Screenshot Analysis

From the broken layout screenshot, these specific symptoms are visible:

| Symptom | Root Cause |
|---------|-----------|
| Agent response text extends past terminal right edge, cut off mid-word ("ag", "ru", "lo") | No width constraint on `AgentMessage` `<Text>` — Ink doesn't wrap text without explicit width |
| `"▪ ag"` fragment floating on right side, `"ent"` on next line left side | The `"▪ agent"` label Box gets split because parent has no width and Ink wraps at terminal boundary mid-element |
| Two sub-agent indicator boxes both visible (20 tool calls, 53 tool calls) | First indicator wasn't cleared before second render — state management issue |
| Footer text clipped at right edge | `justifyContent="space-between"` on FooterBar without width causes right-aligned text to overflow |
| Long paragraphs of agent text have no line breaks | Markdown renderer outputs raw strings with no word wrapping — Ink `<Text>` needs parent Box width to wrap |

---

## Root Causes (ordered by severity)

### 1. CRITICAL: No Top-Level Width Constraint

**File:** `src/tui/app.tsx:1618`

```jsx
<Box flexDirection="column" paddingX={1} paddingY={1}>
```

The root container has no `width` prop. In Ink, a Box without explicit width allows children to expand infinitely. Every child inherits this unbounded width.

**Fix:** Set width on the root container:
```jsx
<Box flexDirection="column" paddingX={1} paddingY={1} width={process.stdout.columns}>
```

Or use a measured width via `useStdout()` hook and `stdout.columns`.

---

### 2. CRITICAL: AgentMessage Text Has No Wrap

**File:** `src/tui/components.tsx:53-55`

```jsx
<Box marginLeft={2}>
  <Text>{rendered}</Text>
</Box>
```

The `<Text>` element contains the full markdown-rendered response (which can be thousands of characters on a single line). Ink's `<Text>` only wraps text if the parent `<Box>` has an explicit `width` or if the Text has a `wrap` prop.

**Fix:** The content Box needs a width that accounts for the 2-char left margin and 2-char paddingX:
```jsx
const { stdout } = useStdout();
const contentWidth = (stdout.columns ?? 80) - 4; // paddingX=1 each side + marginLeft=2
// ...
<Box marginLeft={2} width={contentWidth}>
  <Text wrap="wrap">{rendered}</Text>
</Box>
```

Same issue exists in `UserMessage` (line 38) and `SystemMessage` (line 88).

---

### 3. CRITICAL: FooterBar `space-between` Without Width

**File:** `src/tui/components.tsx:444-465`

```jsx
<Box justifyContent="space-between">
  <Text>{leftContent}</Text>
  <Text>{rightContent}</Text>
</Box>
```

Two rows use `justifyContent="space-between"` without a `width` prop. Without width, Ink expands the Box to fit the sum of both children side-by-side, then spaces them — which can exceed terminal width when both sides have long text.

**Fix:** Give the Box the terminal width:
```jsx
<Box justifyContent="space-between" width={process.stdout.columns - 2}>
```

Or truncate the left-side text to leave room for the right side.

---

### 4. HIGH: Markdown Renderer Uses Hardcoded 40-Char Borders

**File:** `src/tui/markdown.ts:49,53,79,110,114`

```ts
output.push(border("┌" + "─".repeat(40) + label));
output.push(border("└" + "─".repeat(40)));
output.push(border("─".repeat(40))); // HR
```

Code block borders and horizontal rules are fixed at 40 characters regardless of terminal width.

**Fix:** Pass `terminalWidth` into `renderMarkdown` options and calculate:
```ts
const borderWidth = Math.min(terminalWidth - 6, 60); // responsive, max 60
output.push(border("┌" + "─".repeat(borderWidth) + label));
```

---

### 5. HIGH: Markdown Renderer Does No Word Wrapping

**File:** `src/tui/markdown.ts` — entire file

The `renderMarkdown()` function outputs text lines at whatever length the LLM produces. A paragraph that is 500 characters comes through as a single 500-character string. The renderer does not word-wrap.

Ink's `<Text>` can handle wrapping, but only if its parent `<Box>` has an explicit width. Without it, the long string overflows.

**Fix options (choose one):**
- **Option A (recommended):** Don't wrap in the renderer. Instead, ensure the parent `<Box>` has a width and `<Text wrap="wrap">` is used. This lets Ink handle wrapping natively and is responsive to terminal resize.
- **Option B:** Wrap in the renderer using `wrapAnsi(line, terminalWidth - indent, { hard: true })`. This bakes in the width at render time (less responsive but simpler).

---

### 6. HIGH: SubAgentIndicator Stale State

**File:** `src/tui/app.tsx` — sub-agent progress state management

The screenshot shows TWO sub-agent indicator boxes. This means the state from the first sub-agent call wasn't cleaned up before the second appeared. If the LLM calls `launch_subagent` twice in one turn, the first indicator's "done" event clears the state, but then the component is already rendered in the Static/dynamic message split.

**Fix:** Sub-agent indicators should not persist in the conversation message history. They should be a single, live-updating overlay that exists only while a sub-agent is running. When status becomes "done", the indicator is replaced by a collapsed summary line in the conversation (similar to the tool activity summary).

---

### 7. MEDIUM: SuggestionDropdown Item Overflow

**File:** `src/tui/components.tsx:354-356`

```jsx
const label = `/${s.name}${badge} — ${s.description}`;
<Text inverse bold>{` ${prefix} ${label} `}</Text>
```

Long skill descriptions are concatenated into a single string. If the description is long, the line overflows.

**Fix:** Truncate the label:
```ts
const maxLen = (process.stdout.columns ?? 80) - 10;
const label = truncate(`/${s.name}${badge} — ${s.description}`, maxLen);
```

---

### 8. MEDIUM: Charter Review Panel Long Text

**File:** `src/tui/app.tsx:1677-1700`

Charter content (research question, success criteria, proposed steps) is rendered as `<Text>{longString}</Text>` inside a bordered Box without width.

**Fix:** Same as AgentMessage — give the parent Box an explicit width or use `<Text wrap="wrap">`.

---

## Architectural Fix Strategy

The root fix is simple: **every component that renders variable-length text must know its available width.**

### Approach: Width-Aware Render Tree

1. **Root Box** gets `width={stdout.columns}` via `useStdout()`
2. **Message containers** calculate their content width: `rootWidth - paddingX*2 - marginLeft`
3. **Text elements** use `<Text wrap="wrap">` when inside a width-constrained Box
4. **Markdown renderer** receives terminal width for responsive code block borders
5. **Footer** uses explicit width or truncates long status text

### Implementation Checklist

- [ ] Add `width` to root `<Box>` in `app.tsx` using `useStdout().stdout.columns`
- [ ] Add `width` prop to message content Boxes in `AgentMessage`, `UserMessage`, `SystemMessage`
- [ ] Add `wrap="wrap"` to `<Text>` elements that render variable-length content
- [ ] Pass terminal width to `renderMarkdown()` and use it for code block borders
- [ ] Add width to `FooterBar`'s `justifyContent="space-between"` Boxes
- [ ] Truncate long text in `SuggestionDropdown` items
- [ ] Fix sub-agent indicator to be a single live overlay, not persisted per-invocation
- [ ] Add `useStdout()` resize listener so layout reflows on terminal resize
- [ ] Test at terminal widths: 60, 80, 120, 200 columns
- [ ] Test with long agent responses (500+ character paragraphs)
- [ ] Test with multiple sub-agent calls in a single turn

### Files to Modify

| File | Changes |
|------|---------|
| `src/tui/app.tsx` | Root width, sub-agent state cleanup, charter panel width |
| `src/tui/components.tsx` | All message components width, FooterBar width, dropdown truncation |
| `src/tui/markdown.ts` | Accept terminal width, responsive borders |
| `src/tui/streaming.ts` | (Optional) Pre-wrap text during streaming for smoother rendering |

---

## Quick Win vs. Full Fix

**Quick win (30 min):** Add `width={stdout.columns}` to root Box + `wrap="wrap"` on all `<Text>` elements with variable content. This alone fixes 80% of overflow issues.

**Full fix (2-3 hrs):** All checklist items above, including responsive markdown borders, dropdown truncation, sub-agent indicator lifecycle, and resize handling.
