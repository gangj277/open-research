import React from "react";
import { Box, Text } from "ink";
import wrapAnsi from "wrap-ansi";
import { renderMarkdown } from "@/tui/markdown";
import { getTerminalWidth, insetWidth, truncateToWidth } from "@/tui/layout";
import { useTheme } from "@/tui/theme";

// ── Gutter Icons ────────────────────────────────────────────────────────────
// Consistent left-margin indicators for message types

export const GUTTER = {
  user: "›",
  agent: "▪",
  system: "·",
  tool: "↳",
  error: "✗",
  success: "✓",
  question: "?",
  pending: "○",
  active: "●",
} as const;

function resolveWidth(width?: number) {
  return getTerminalWidth(width);
}

function indentedWidth(width: number, indent = 2) {
  return insetWidth(width, indent);
}

function borderedContentWidth(width: number) {
  return insetWidth(width, 4);
}

function wrapText(value: string, width: number) {
  return wrapAnsi(value, Math.max(1, width), { trim: false, hard: true });
}

// ── Divider ─────────────────────────────────────────────────────────────────

export function Divider({ width, color }: { width?: number; color?: string }) {
  const theme = useTheme();
  const w = insetWidth(resolveWidth(width), 4);
  return <Text color={color ?? theme.muted} dimColor>{"─".repeat(Math.max(1, w))}</Text>;
}

// ── Message Components ──────────────────────────────────────────────────────

export function UserMessage({ text, width }: { text: string; width?: number }) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const bodyWidth = indentedWidth(contentWidth);
  const wrappedText = wrapText(text, bodyWidth);
  return (
    <Box flexDirection="column" marginBottom={1} width={contentWidth}>
      <Box width={contentWidth}>
        <Text color={theme.accent} bold>{GUTTER.user} </Text>
        <Text bold color={theme.accent}>you</Text>
      </Box>
      <Box marginLeft={2} width={bodyWidth}>
        <Text color={theme.text} wrap="wrap">{wrappedText}</Text>
      </Box>
    </Box>
  );
}

export function AgentMessage({ text, width }: { text: string; width?: number }) {
  const contentWidth = resolveWidth(width);
  const bodyWidth = indentedWidth(contentWidth);
  const theme = useTheme();
  const rendered = renderMarkdown(text, { theme: theme.mode, terminalWidth: bodyWidth });
  const wrappedText = wrapText(rendered, bodyWidth);
  return (
    <Box flexDirection="column" marginBottom={1} width={contentWidth}>
      <Box width={contentWidth}>
        <Text color={theme.secondary} bold>{GUTTER.agent} </Text>
        <Text bold color={theme.secondary}>agent</Text>
      </Box>
      <Box marginLeft={2} width={bodyWidth}>
        <Text wrap="wrap">{wrappedText}</Text>
      </Box>
    </Box>
  );
}

// ── Task Panel ─────────────────────────────────────────────────────────────

export function TaskPanel({
  tasks,
  frame,
  width,
}: {
  tasks: Array<{ id: string; subject: string; activeForm?: string; status: string }>;
  frame: string;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const completed = tasks.filter((t) => t.status === "completed");
  const active = tasks.filter((t) => t.status !== "completed");

  if (tasks.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1} marginLeft={2} width={indentedWidth(contentWidth)}>
      {active.map((task) => {
        const icon = task.status === "in_progress" ? frame : GUTTER.pending;
        const color = task.status === "in_progress" ? theme.warning : theme.text;
        const label = task.status === "in_progress"
          ? (task.activeForm ?? task.subject)
          : task.subject;
        return (
          <Text key={task.id} color={color}>
            {"  "}{icon} {label}
          </Text>
        );
      })}
      {completed.length > 0 && (
        <Text color={theme.muted} dimColor>
          {"  "}{GUTTER.success} {completed.length} completed
        </Text>
      )}
    </Box>
  );
}

// ── Tool Activity Summary (collapsed / expanded) ───────────────────────────

export function ToolActivitySummary({
  summary,
  tools,
  expanded = false,
  width,
}: {
  summary: string;
  tools: Array<{ name: string; description: string; durationMs?: number }>;
  expanded?: boolean;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = indentedWidth(resolveWidth(width));
  if (expanded) {
    // Expanded: show every tool call with duration
    return (
      <Box flexDirection="column" marginLeft={2} marginBottom={0} width={contentWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">
          {GUTTER.tool} {summary}
        </Text>
        {tools.map((t, i) => {
          const dur = t.durationMs ? ` (${(t.durationMs / 1000).toFixed(1)}s)` : "";
          const prefix = i === tools.length - 1 ? "└" : "├";
          return (
            <Text key={i} color={theme.muted} dimColor wrap="wrap">
              {"  "}{prefix} {GUTTER.success} {t.description}{dur}
            </Text>
          );
        })}
      </Box>
    );
  }

  // Collapsed: summary line + last target
  const lastTarget = tools.length > 0 ? tools[tools.length - 1].description : "";
  const hint = tools.length > 1 ? " (ctrl+o to expand)" : "";

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={0} width={contentWidth}>
      <Text color={theme.muted} dimColor wrap="wrap">
        {GUTTER.tool} {summary}{hint}
      </Text>
      {lastTarget && tools.length > 1 && (
        <Text color={theme.muted} dimColor wrap="wrap">
          {"  └ "}{lastTarget}
        </Text>
      )}
    </Box>
  );
}

// ── Sub-Agent Live Indicator ────────────────────────────────────────────────

export function SubAgentIndicator({
  agentType,
  goal,
  currentTool,
  toolCount,
  frame,
  width,
}: {
  agentType: string;
  goal: string;
  currentTool: string;
  toolCount: number;
  frame: string;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = indentedWidth(resolveWidth(width));
  const innerWidth = borderedContentWidth(contentWidth);
  const shortGoal = goal.length > 160 ? goal.slice(0, 157) + "..." : goal;
  const status = currentTool || "thinking...";

  return (
    <Box
      flexDirection="column"
      marginLeft={2}
      marginBottom={1}
      paddingX={1}
      width={contentWidth}
      borderStyle="round"
      borderColor={theme.warning}
    >
      <Text color={theme.warning} bold wrap="wrap">
        {frame} {agentType} agent
        <Text color={theme.muted} dimColor> · {toolCount} tool call{toolCount !== 1 ? "s" : ""}</Text>
      </Text>
      <Box width={innerWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">  {shortGoal}</Text>
      </Box>
      <Box width={innerWidth}>
        <Text color={theme.text} wrap="wrap">  └ {status}</Text>
      </Box>
    </Box>
  );
}

export function SystemMessage({ text, width }: { text: string; width?: number }) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const indentedContentWidth = indentedWidth(contentWidth);
  const wrappedIndentedText = wrapText(text, indentedContentWidth);
  const wrappedText = wrapText(text, contentWidth);
  // Tool activity lines (✓ prefix) get special treatment
  if (text.trimStart().startsWith("✓") || text.trimStart().startsWith("✗")) {
    return (
      <Box marginLeft={2} width={indentedContentWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">{wrappedIndentedText}</Text>
      </Box>
    );
  }
  // Compaction notices
  if (text.includes("compacted") || text.includes("Context")) {
    return (
      <Box marginLeft={2} width={indentedContentWidth}>
        <Text color={theme.warning} dimColor wrap="wrap">{wrapText(`${GUTTER.system} ${text.trim()}`, indentedContentWidth)}</Text>
      </Box>
    );
  }
  // Command echoes (> /auth etc)
  if (text.trimStart().startsWith(">")) {
    return (
      <Box width={contentWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">{wrappedText}</Text>
      </Box>
    );
  }
  return (
    <Box width={contentWidth}>
      <Text color={theme.muted} wrap="wrap">{wrapText(`${GUTTER.system} ${text.trim()}`, contentWidth)}</Text>
    </Box>
  );
}

// ── Prompt Prefix ───────────────────────────────────────────────────────────

export function PromptPrefix({
  busy,
  frame,
  hasQuestion,
  mode,
}: {
  busy: boolean;
  frame: string;
  hasQuestion: boolean;
  mode: string;
}) {
  const theme = useTheme();
  if (hasQuestion) {
    return <Text color={theme.warning}>{GUTTER.question} </Text>;
  }
  return <Text color={theme.accent}>{GUTTER.user} </Text>;
}

// ── Status Badge ────────────────────────────────────────────────────────────

export function StatusBadge({
  label,
  color,
  dimmed = false,
}: {
  label: string;
  color?: string;
  dimmed?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text color={color ?? theme.muted} dimColor={dimmed}>
      {label}
    </Text>
  );
}

// ── Pending Update Card ─────────────────────────────────────────────────────

export function PendingUpdateCard({
  count,
  summary,
  width,
}: {
  count: number;
  summary: string;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const bodyWidth = indentedWidth(borderedContentWidth(contentWidth));
  return (
    <Box
      borderStyle="single"
      borderColor={theme.pending}
      paddingX={1}
      marginBottom={1}
      flexDirection="column"
      width={contentWidth}
    >
      <Box width={borderedContentWidth(contentWidth)}>
        <Text color={theme.pending} bold>{GUTTER.pending} </Text>
        <Text bold color={theme.pending}>{count} update{count > 1 ? "s" : ""} awaiting review</Text>
      </Box>
      <Box marginLeft={2} width={bodyWidth}>
        <Text color={theme.muted} wrap="wrap">{summary}</Text>
      </Box>
      <Box marginLeft={2} marginTop={0} width={bodyWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">
          <Text bold color={theme.secondary}>a</Text> accept  <Text bold color={theme.error}>r</Text> reject
        </Text>
      </Box>
    </Box>
  );
}

// ── Question Card ───────────────────────────────────────────────────────────

export function QuestionCard({
  question,
  options,
  width,
}: {
  question: string;
  options: Array<{ label: string; description: string }>;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const innerWidth = borderedContentWidth(contentWidth);
  const bodyWidth = indentedWidth(innerWidth);
  return (
    <Box
      borderStyle="single"
      borderColor={theme.warning}
      paddingX={1}
      marginBottom={0}
      flexDirection="column"
      width={contentWidth}
    >
      <Box width={innerWidth}>
        <Text color={theme.warning} bold>{GUTTER.question} </Text>
        <Text bold color={theme.warning}>Agent needs your input</Text>
      </Box>
      <Box marginLeft={2} marginTop={0} width={bodyWidth}>
        <Text color={theme.text} wrap="wrap">{question}</Text>
      </Box>
      {options.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1} width={bodyWidth}>
          {options.map((opt, idx) => (
            <Box key={opt.label} width={bodyWidth}>
              <Text color={theme.accent} bold>{idx + 1}</Text>
              <Text color={theme.text} wrap="wrap"> {opt.label}</Text>
              <Text color={theme.muted} dimColor wrap="wrap"> — {opt.description}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box marginLeft={2} marginTop={0} width={bodyWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">
          {options.length > 0 ? "Type number or custom answer" : "Type your answer"}
        </Text>
      </Box>
    </Box>
  );
}

// ── Home Screen ─────────────────────────────────────────────────────────────

export function HomeScreen({
  hasAuth,
  hasWorkspace,
  fileCount,
  skillCount,
  version,
  model,
  contextWindow,
  workspacePath,
  width,
}: {
  hasAuth: boolean;
  hasWorkspace: boolean;
  fileCount: number;
  skillCount: number;
  version: string;
  model: string;
  contextWindow: number;
  workspacePath: string | null;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const bodyWidth = indentedWidth(contentWidth);
  const ctxLabel = contextWindow >= 1000 ? `${Math.round(contextWindow / 1000)}k` : String(contextWindow);
  const shortPath = workspacePath
    ? workspacePath.replace(process.env.HOME ?? "", "~")
    : process.cwd().replace(process.env.HOME ?? "", "~");

  return (
    <Box flexDirection="column" marginBottom={1} width={contentWidth}>
      {/* Init banner */}
      <Box width={contentWidth}>
        <Text bold color={theme.accent}>{"⚡ "}</Text>
        <Text bold color={theme.accent}>Open Research</Text>
        <Text color={theme.muted}> v{version}</Text>
        <Text color={theme.muted} dimColor> | </Text>
        <Text color={theme.text}>◆ {model}</Text>
        <Text color={theme.muted} dimColor> | </Text>
        <Text color={theme.muted}>{ctxLabel} context</Text>
      </Box>
      <Box marginLeft={2} width={bodyWidth}>
        <Text color={theme.muted} dimColor>{shortPath}</Text>
        {hasWorkspace && (
          <Text color={theme.muted} dimColor> · {fileCount} files · {skillCount} skills</Text>
        )}
      </Box>

      {/* Status hints */}
      {!hasAuth && (
        <Box flexDirection="column" marginTop={1} width={contentWidth}>
          <Box width={contentWidth}>
            <Text color={theme.warning}>{GUTTER.pending} </Text>
            <Text color={theme.warning}>Connect OpenAI to get started</Text>
          </Box>
          <Box marginLeft={2} width={bodyWidth}>
            <Text color={theme.muted} wrap="wrap">/config apikey sk-...  ·  /auth  ·  /auth-codex</Text>
          </Box>
        </Box>
      )}

      {hasAuth && !hasWorkspace && (
        <Box flexDirection="column" marginTop={1} width={contentWidth}>
          <Box width={contentWidth}>
            <Text color={theme.warning}>{GUTTER.pending} </Text>
            <Text color={theme.warning}>Run /init to create a workspace</Text>
          </Box>
        </Box>
      )}

      {hasAuth && hasWorkspace && (
        <Box marginTop={1} width={contentWidth}>
          <Text color={theme.muted} dimColor>Ask a question, @mention a file, or type /help</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Suggestion Dropdown ─────────────────────────────────────────────────────

export type SuggestionItem =
  | { kind: "command"; name: string; description: string }
  | { kind: "skill"; name: string; description: string; source: string }
  | { kind: "file"; path: string; label: string };

export function SuggestionDropdown({
  items,
  selectedIndex,
  width,
}: {
  items: SuggestionItem[];
  selectedIndex: number;
  width?: number;
}) {
  const theme = useTheme();
  if (items.length === 0) return null;
  const contentWidth = resolveWidth(width);
  const rowWidth = borderedContentWidth(contentWidth);

  // Sliding window: show up to 10 items, scroll to keep selectedIndex visible
  const maxVisible = 10;
  const total = items.length;
  let windowStart = 0;
  if (total > maxVisible) {
    // Keep selection roughly centered, clamped to bounds
    windowStart = Math.min(
      Math.max(0, selectedIndex - Math.floor(maxVisible / 2)),
      total - maxVisible
    );
  }
  const visibleItems = items.slice(windowStart, windowStart + maxVisible);
  const showScrollUp = windowStart > 0;
  const showScrollDown = windowStart + maxVisible < total;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.borderDefault}
      paddingX={1}
      marginBottom={0}
      width={contentWidth}
    >
      {showScrollUp && <Text color={theme.muted} dimColor wrap="truncate-end"> ↑ {windowStart} more</Text>}
      {visibleItems.map((s, visIdx) => {
        const realIdx = windowStart + visIdx;
        const selected = realIdx === selectedIndex;
        const prefix = selected ? "›" : " ";

        if (s.kind === "file") {
          const label = truncateToWidth(` ${prefix} @${s.path} `, rowWidth);
          return selected ? (
            <Box key={`file-${s.path}`} width={rowWidth}>
              <Text inverse bold wrap="truncate-end">{label}</Text>
            </Box>
          ) : (
            <Box key={`file-${s.path}`} width={rowWidth}>
              <Text wrap="truncate-end">
                <Text color={theme.muted}>{prefix} </Text>
                <Text color={theme.file}>@{s.path}</Text>
              </Text>
            </Box>
          );
        }

        const nameColor = s.kind === "skill" ? theme.skill : theme.accent;
        const badge = s.kind === "skill" ? " [skill]" : "";
        const label = `/${s.name}${badge} — ${s.description}`;
        const selectedLabel = truncateToWidth(` ${prefix} ${label} `, rowWidth);

        return selected ? (
          <Box key={`${s.kind}-${s.name}`} width={rowWidth}>
            <Text inverse bold wrap="truncate-end">{selectedLabel}</Text>
          </Box>
        ) : (
          <Box key={`${s.kind}-${s.name}`} width={rowWidth}>
            <Text wrap="truncate-end">
              <Text color={theme.muted}>{prefix} </Text>
              <Text color={nameColor}>/{s.name}</Text>
              <Text color={theme.muted} dimColor>{badge} — {s.description}</Text>
            </Text>
          </Box>
        );
      })}
      {showScrollDown && <Text color={theme.muted} dimColor wrap="truncate-end"> ↓ {total - windowStart - maxVisible} more</Text>}
      <Text color={theme.muted} dimColor wrap="truncate-end"> ↑↓ navigate · enter select · tab complete</Text>
    </Box>
  );
}

// ── Footer Status Bar ───────────────────────────────────────────────────────

export function FooterBar({
  width,
  busy,
  frame,
  toolActivity,
  toolCount,
  statusParts,
  statusColor,
  tokenDisplay,
  workspaceName,
  mode,
  planningStatus,
}: {
  width?: number;
  busy: boolean;
  frame: string;
  toolActivity: string;
  toolCount?: number;
  statusParts: string[];
  statusColor: string;
  tokenDisplay: string;
  workspaceName: string;
  mode: string;
  planningStatus: string;
}) {
  const theme = useTheme();
  const modeLabel = mode === "auto-research" ? "auto" : mode === "auto-approve" ? "approve" : "review";
  const planLabel = planningStatus !== "idle" ? ` · ${planningStatus}` : "";
  const countLabel = typeof toolCount === "number" && (toolCount > 0 || toolActivity.startsWith("Running"))
    ? ` (${toolCount} done)`
    : "";
  const contentWidth = resolveWidth(width);
  const topLeft = busy
    ? toolActivity
      ? `${frame} ${toolActivity}${countLabel}`
      : `${frame} thinking...`
    : `${GUTTER.active} ${statusParts.join(" · ")}`;
  const topRight = tokenDisplay ? `${tokenDisplay} · ${workspaceName}` : workspaceName;
  const bottomLeft = `${modeLabel}${planLabel} · shift+tab cycle · /help`;
  const bottomRight = "shift+enter newline · esc cancel";
  const rightColumnWidth = Math.max(14, Math.min(Math.floor(contentWidth * 0.4), contentWidth - 12));
  const leftColumnWidth = Math.max(1, contentWidth - rightColumnWidth - 1);

  return (
    <Box flexDirection="column" marginTop={0} width={contentWidth}>
      <Box width={contentWidth}>
        <Box width={leftColumnWidth}>
          <Text color={statusColor} wrap="truncate-end">{topLeft}</Text>
        </Box>
        <Box width={1}>
          <Text> </Text>
        </Box>
        <Box width={rightColumnWidth} justifyContent="flex-end">
          <Text color={theme.muted} dimColor wrap="truncate-start">{topRight}</Text>
        </Box>
      </Box>
      <Box width={contentWidth}>
        <Box width={leftColumnWidth}>
          <Text color={theme.muted} dimColor wrap="truncate-end">{bottomLeft}</Text>
        </Box>
        <Box width={1}>
          <Text> </Text>
        </Box>
        <Box width={rightColumnWidth} justifyContent="flex-end">
          <Text color={theme.muted} dimColor wrap="truncate-start">{bottomRight}</Text>
        </Box>
      </Box>
    </Box>
  );
}
