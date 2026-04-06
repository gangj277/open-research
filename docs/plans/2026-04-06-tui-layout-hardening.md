# TUI Layout Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Ink TUI reliably respect terminal width so long messages, footers, dropdowns, and markdown blocks stay readable across narrow and wide terminals.

**Architecture:** Introduce a width-aware render path from the root app container down into message, footer, and overlay components. Keep paragraph wrapping native to Ink where possible, but make markdown chrome such as code fences and quotes width-aware at render time so prefixed lines remain visually intact.

**Tech Stack:** TypeScript, React 19, Ink 6, ink-testing-library, Vitest

---

### Task 1: Lock down the real regressions with failing tests

**Files:**
- Create: `tests/tui/layout.test.tsx`
- Modify: `tests/tui/markdown.test.ts`
- Check: `src/tui/app.tsx`
- Check: `src/tui/components.tsx`

**Step 1: Write failing tests**

Cover these behaviors:
- a long agent response rendered in a narrow terminal never produces visible lines wider than the terminal
- footer rows stay within the available width even when status and workspace metadata are long
- suggestion rows truncate instead of spilling horizontally
- markdown code block borders adapt to the provided terminal width

**Step 2: Run targeted tests to verify they fail**

Run: `npm test -- tests/tui/layout.test.tsx tests/tui/markdown.test.ts`

Expected: FAIL because the current TUI does not propagate width constraints through key containers and markdown still uses fixed-width borders

### Task 2: Make the app render tree width-aware

**Files:**
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/components.tsx`

**Step 1: Track terminal width in the app**

Use Ink stdout width plus a resize listener so the root container and dependent UI recompute when terminal size changes.

**Step 2: Pass width into variable-content components**

Constrain the root container, conversation messages, footer, dropdown, pending cards, question cards, and charter review panel so they render within the measured viewport.

**Step 3: Harden high-risk rows**

Use wrap or truncation modes intentionally:
- wrap message and panel bodies
- truncate compact dropdown/footer metadata where a single-line row is preferable

### Task 3: Make markdown chrome responsive

**Files:**
- Modify: `src/tui/markdown.ts`

**Step 1: Accept terminal width as a render option**

Use the passed width to size horizontal rules and code fence borders.

**Step 2: Preserve prefixed block formatting**

Wrap code block and quote content with the prefix accounted for so continuation lines stay visually aligned.

### Task 4: Verify the hardening end-to-end

**Files:**
- Test: `tests/tui/layout.test.tsx`
- Test: `tests/tui/markdown.test.ts`
- Check: `tests/tui/app.test.tsx`
- Check: `tests/tui/streaming-stability.test.tsx`

**Step 1: Run focused layout tests**

Run: `npm test -- tests/tui/layout.test.tsx tests/tui/markdown.test.ts`

Expected: PASS

**Step 2: Run nearby TUI regression tests**

Run: `npm test -- tests/tui/app.test.tsx tests/tui/ctrl-c.test.tsx tests/tui/busy-composer.test.tsx tests/tui/streaming-stability.test.tsx tests/tui/text-input.test.tsx`

Expected: PASS

**Step 3: Run the full suite if focused checks are green**

Run: `npm test`

Expected: PASS
