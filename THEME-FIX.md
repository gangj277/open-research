# Theme System Fix — Root Cause Analysis & Implementation Plan

## Problem

`/config theme light` persists the setting but nothing changes visually. All UI elements stay dark-themed on light terminal backgrounds, making text invisible (gray on white, white on white).

## Root Cause

**The theme infrastructure works — nothing uses it.**

The plumbing is correct end-to-end:
- `ThemeProvider` wraps the entire app in `app.tsx:1622`
- `useTheme()` hook returns the right `ThemeColors` object (dark or light)
- Theme state updates when user runs `/config theme light`
- Config persists to disk and loads on restart

But **0 out of 15+ components** actually consume the theme context for rendering. Every single component hardcodes color strings like `color="gray"`, `color="cyan"`, `color="green"` directly in JSX — completely bypassing the theme system.

The markdown renderer (`markdown.ts`) is the only file with internal theme awareness, but it only affects agent message body text.

## Scope: ~91 hardcoded color instances across 6 files

### Priority 1: `src/tui/components.tsx` — 55 instances, 15 components

This is the core UI. Every component needs `const theme = useTheme()` and replacement of hardcoded colors:

| Component | Hardcoded Colors | Theme Mapping |
|-----------|-----------------|---------------|
| **Divider** | `"gray"` default param | `theme.muted` |
| **UserMessage** | `"cyan"` x2 | `theme.accent` |
| **AgentMessage** | `"green"` x2 | `theme.secondary` |
| **ToolActivitySummary** | `"gray"` x4 | `theme.muted` |
| **SubAgentIndicator** | `"yellow"` x2, `"gray"` x2, `"white"` x1 | `theme.warning`, `theme.muted`, `theme.text` |
| **SystemMessage** | `"gray"` x3, `"yellow"` x1 | `theme.muted`, `theme.warning` |
| **PromptPrefix** | `"yellow"`, `"cyan"` | `theme.warning`, `theme.accent` |
| **PendingUpdateCard** | `"magenta"` x3, `"gray"`, `"green"`, `"red"` | `theme.pending`, `theme.muted`, `theme.secondary`, `theme.error` |
| **QuestionCard** | `"yellow"` x2, `"cyan"`, `"gray"` x2 | `theme.warning`, `theme.accent`, `theme.muted` |
| **HomeScreen** | `"cyan"` x1, `"gray"` x5, `"yellow"` x4, `"green"` x4 | `theme.accent`, `theme.muted`, `theme.warning`, `theme.secondary` |
| **SuggestionDropdown** | `"gray"` x5, `"green"`, `"magenta"`, `"cyan"` | `theme.muted`, `theme.file`, `theme.skill`, `theme.accent` |
| **FooterBar** | `"gray"` x3 | `theme.muted` |

**Pattern for each component:**
```tsx
// BEFORE
export function UserMessage({ text }: { text: string }) {
  return (
    <Box>
      <Text color="cyan" bold>{GUTTER.user} </Text>
      <Text bold color="cyan">you</Text>
    </Box>
  );
}

// AFTER
export function UserMessage({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Box>
      <Text color={theme.accent} bold>{GUTTER.user} </Text>
      <Text bold color={theme.accent}>you</Text>
    </Box>
  );
}
```

### Priority 2: `src/tui/app.tsx` — 13 instances

The Research Charter review panel (lines ~1669-1705) hardcodes `"yellow"`, `"white"`, `"gray"`, `"green"`, `"cyan"`, `"red"`.

Since this section is inside the `App` component, it has access to React hooks. Add `const theme = useTheme()` at the top of the App component (it already exists as `theme` state — use `const themeColors = useTheme()` to avoid collision) and replace all instances.

Also: the mode indicator line (~line 1762) hardcodes `color="yellow"` and `color="gray"`.

### Priority 3: `src/tui/session-picker.tsx` — 10 instances

All `"gray"` and one `"cyan"` / `"gray"` conditional for border colors. Add `useTheme()` import and call it at the top of the component.

### Priority 4: `src/tui/config-screen.tsx` — 8 instances

Same pattern. `"cyan"`, `"gray"`, `"green"`, `"white"` need replacement.

### Priority 5: `src/tui/text-input.tsx` — 5 instances

This is the tricky one. `text-input.tsx` uses `chalk` directly (not Ink `<Text>` props) because it builds rendered strings with cursor positioning. The hardcoded colors:

| Line | Current | Fix |
|------|---------|-----|
| 221 | `chalk.dim.cyan` (paste badge) | Accept `accentColor` prop, use `chalk.hex(accentColor)` |
| 257 | `chalk.inverse.blueBright` (slash cmd at cursor) | Use accent color |
| 262 | `chalk.blueBright` (slash cmd chars) | Use accent color |
| 284 | `chalk.blueBright` (slash cmd unfocused) | Use accent color |
| 295-297 | `chalk.grey` (placeholder) | Accept `mutedColor` prop |

**Approach:** Add optional `accentColor?: string` and `mutedColor?: string` props. The parent (`app.tsx`) passes `themeColors.accent` and `themeColors.muted`. Inside `text-input.tsx`, use `chalk.hex(accentColor)` instead of `chalk.blueBright`.

### Priority 6: `src/tui/markdown.ts` — Fallback defaults

Lines 126-128 in `renderInline` have hardcoded default parameter values (`chalk.cyan`, `chalk.blue`, `chalk.gray.dim`). These are always overridden by `renderMarkdown` today, but should match a sensible default. Low priority since it's already working.

## ThemeColors Reference (from `theme.tsx`)

```
Dark Theme                      Light Theme
─────────────────────           ─────────────────────
accent:        "cyan"           accent:        "blue"
secondary:     "green"          secondary:     "green"
warning:       "yellow"         warning:       "#b8860b"
error:         "red"            error:         "red"
muted:         "gray"           muted:         "#666666"
text:          "white"          text:          "#1a1a1a"
highlight:     "white"          highlight:     "#1a1a1a"
skill:         "magenta"        skill:         "#8b008b"
file:          "green"          file:          "#006400"
pending:       "magenta"        pending:       "#8b008b"
borderFocused: "cyan"           borderFocused: "blue"
borderDefault: "gray"           borderDefault: "#999999"
```

Key differences: light theme uses hex colors (`#666666`, `#1a1a1a`, `#999999`) instead of named colors because named `"gray"` and `"white"` are invisible on light terminal backgrounds.

## Verification

After each component is fixed:
1. Run `npm run dev`
2. `/config theme light` — all text should be readable on a light terminal
3. `/config theme dark` — all text should be readable on a dark terminal
4. Test each screen: home, conversation, session picker, config screen
5. Test each component: user messages, agent messages, tool summaries, pending updates, question cards, suggestion dropdown, footer

## Estimated Effort

- `components.tsx`: 55 replacements across 15 components — **~45 min**
- `app.tsx`: 13 replacements + add `useTheme()` — **~15 min**
- `session-picker.tsx`: 10 replacements — **~10 min**
- `config-screen.tsx`: 8 replacements — **~10 min**
- `text-input.tsx`: Add props + 5 chalk replacements — **~20 min**
- Testing both themes on all screens — **~20 min**

**Total: ~2 hours**

## Key Principle

After this fix, there should be **zero** hardcoded color strings in any TUI file. Every color must come from `useTheme()`. This makes future theme additions (high contrast, solarized, etc.) trivial — just add a new `ThemeColors` object.
