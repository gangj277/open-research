# Busy Composer Drafting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the chat composer available for drafting the next user message while the agent is still working, and move the busy signal out of the input area.

**Architecture:** Preserve streaming/busy state in the footer and tool activity bar, but stop repurposing the prompt box as an agent-status surface. The main app stays responsible for busy-state orchestration, while the prompt prefix, border color, focus state, and placeholder all shift toward a persistent user-composer model.

**Tech Stack:** TypeScript, React 19, Ink 6, ink-testing-library, Vitest

---

### Task 1: Lock in the UX with failing tests

**Files:**
- Create: `tests/tui/busy-composer.test.tsx`
- Check: `src/tui/app.tsx`
- Check: `src/tui/components.tsx`

**Step 1: Write the failing test**

Cover these behaviors:
- after sending a prompt, the busy footer still shows agent activity
- the input area no longer shows `Agent is working...`
- the user can type a draft into the composer while the agent is still streaming
- pressing Enter while busy does not submit a second turn and preserves the draft

**Step 2: Run the targeted test to verify it fails**

Run: `npm test -- tests/tui/busy-composer.test.tsx`
Expected: FAIL because the app currently defocuses the composer and replaces the input placeholder with the busy message

### Task 2: Implement the persistent composer behavior

**Files:**
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/components.tsx`

**Step 1: Keep the composer focused during active turns**

Remove the forced `setComposerFocused(false)` transitions from agent-turn start paths so the user can keep typing immediately after sending a message.

**Step 2: Stop using the prompt box as the busy indicator**

Update the prompt box rendering so:
- the border stays user-oriented while composing
- the prompt prefix remains the user marker unless the agent is asking a question
- the placeholder invites drafting instead of showing `Agent is working...`

**Step 3: Keep submit safety unchanged**

Retain the existing `if (busy) return;` guard in `handleSubmit` so drafting is allowed but overlapping turns are still prevented.

### Task 3: Verify and clean up

**Files:**
- Check: `tests/tui/busy-composer.test.tsx`
- Check: `tests/tui/app.test.tsx`
- Check: `tests/tui/text-input.test.tsx`

**Step 1: Run the focused busy-composer test**

Run: `npm test -- tests/tui/busy-composer.test.tsx`
Expected: PASS

**Step 2: Run nearby TUI regression tests**

Run: `npm test -- tests/tui/app.test.tsx tests/tui/text-input.test.tsx tests/tui/ctrl-c.test.tsx`
Expected: PASS

**Step 3: Run the full suite**

Run: `npm test`
Expected: PASS
