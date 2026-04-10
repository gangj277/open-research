import React, { memo, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import wrapAnsi from "wrap-ansi";
import { structuredPatch } from "diff";
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

export const UserMessage = memo(function UserMessage({ text, turnNumber, width }: { text: string; turnNumber?: number; width?: number }) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const bodyWidth = indentedWidth(contentWidth);
  const wrappedText = wrapText(text, bodyWidth);
  return (
    <Box flexDirection="column" marginBottom={1} width={contentWidth}>
      <Box width={contentWidth}>
        <Text color={theme.accent} bold>{GUTTER.user} </Text>
        <Text bold color={theme.accent}>you</Text>
        {typeof turnNumber === "number" && (
          <Text color={theme.muted} dimColor> {GUTTER.system} #{turnNumber}</Text>
        )}
      </Box>
      <Box marginLeft={2} width={bodyWidth}>
        <Text color={theme.text} wrap="wrap">{wrappedText}</Text>
      </Box>
    </Box>
  );
});

export const AgentMessage = memo(function AgentMessage({ text, width }: { text: string; width?: number }) {
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
});

// ── Thinking Indicator ────────────────────────────────────────────────────

export function ThinkingIndicator({ frame, width }: { frame: string; width?: number }) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  return (
    <Box marginBottom={1} width={contentWidth}>
      <Text color={theme.secondary} bold>{GUTTER.agent} </Text>
      <Text color={theme.muted} dimColor>{frame} thinking...</Text>
    </Box>
  );
}

// ── Tool Activity Summary (collapsed / expanded) ───────────────────────────

export const ToolActivitySummary = memo(function ToolActivitySummary({
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
  const innerWidth = indentedWidth(contentWidth, 4);
  if (expanded) {
    return (
      <Box flexDirection="row" marginLeft={2} marginBottom={0} width={contentWidth}>
        <Text color={theme.muted} dimColor>{"│ "}</Text>
        <Box flexDirection="column" width={innerWidth}>
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
      </Box>
    );
  }

  // Collapsed: summary line + last target
  const lastTarget = tools.length > 0 ? tools[tools.length - 1].description : "";
  const hint = tools.length > 1 ? " (ctrl+o to expand)" : "";

  return (
    <Box flexDirection="row" marginLeft={2} marginBottom={0} width={contentWidth}>
      <Text color={theme.muted} dimColor>{"│ "}</Text>
      <Box flexDirection="column" width={innerWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">
          {GUTTER.tool} {summary}{hint}
        </Text>
        {lastTarget && tools.length > 1 && (
          <Text color={theme.muted} dimColor wrap="wrap">
            {"  └ "}{lastTarget}
          </Text>
        )}
      </Box>
    </Box>
  );
});

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

export const SystemMessage = memo(function SystemMessage({ text, width }: { text: string; width?: number }) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const indentedContentWidth = indentedWidth(contentWidth);
  const wrappedIndentedText = wrapText(text, indentedContentWidth);
  const wrappedText = wrapText(text, contentWidth);
  const trimmed = text.trimStart();

  // Tool activity lines (checkmark/cross prefix) get special treatment
  if (trimmed.startsWith("\u2713") || trimmed.startsWith("\u2717")) {
    return (
      <Box marginLeft={2} width={indentedContentWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">{wrappedIndentedText}</Text>
      </Box>
    );
  }

  // Error messages — elevated styling
  if (trimmed.startsWith("Error:") || trimmed.startsWith("Failed:")) {
    return (
      <Box marginLeft={2} width={indentedContentWidth}>
        <Text color={theme.error} wrap="wrap">{wrapText(`${GUTTER.error} ${text.trim()}`, indentedContentWidth)}</Text>
      </Box>
    );
  }

  // Memory / ontology updates — accent-tinted, important
  if (trimmed.includes("\u25CA remembered:") || trimmed.includes("\u25CA ontology") || trimmed.includes("\u25CA learned:")) {
    return (
      <Box marginLeft={2} width={indentedContentWidth}>
        <Text color={theme.accent} dimColor wrap="wrap">{wrapText(text.trim(), indentedContentWidth)}</Text>
      </Box>
    );
  }

  // Compaction notices — warning tier
  if (text.includes("compacted") || text.includes("Context compacted")) {
    return (
      <Box marginLeft={2} width={indentedContentWidth}>
        <Text color={theme.warning} dimColor wrap="wrap">{wrapText(`${GUTTER.system} ${text.trim()}`, indentedContentWidth)}</Text>
      </Box>
    );
  }

  // Command echoes (> /auth etc)
  if (trimmed.startsWith(">")) {
    return (
      <Box width={contentWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">{wrappedText}</Text>
      </Box>
    );
  }

  // Default: muted routine messages
  return (
    <Box width={contentWidth}>
      <Text color={theme.muted} wrap="wrap">{wrapText(`${GUTTER.system} ${text.trim()}`, contentWidth)}</Text>
    </Box>
  );
});

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

// ── Diff Lines ──────────────────────────────────────────────────────────────

interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
}

const MAX_DIFF_LINES = 16;

/** Compute diff lines from old/new content using structuredPatch */
function computeDiffLines(oldContent: string | undefined, newContent: string, fileName: string): DiffLine[] {
  if (oldContent == null) {
    // New file — show all lines as additions (capped)
    const lines = newContent.split("\n");
    return lines.slice(0, MAX_DIFF_LINES + 4).map((l) => ({ type: "add" as const, text: l }));
  }

  const patch = structuredPatch(fileName, fileName, oldContent, newContent, "", "", { context: 2 });
  const result: DiffLine[] = [];

  for (const hunk of patch.hunks) {
    if (result.length > 0) {
      result.push({ type: "ctx", text: "···" });
    }
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        result.push({ type: "add", text: line.slice(1) });
      } else if (line.startsWith("-")) {
        result.push({ type: "del", text: line.slice(1) });
      } else {
        result.push({ type: "ctx", text: line.slice(1) });
      }
    }
  }
  return result;
}

// ── Pending Update Card ─────────────────────────────────────────────────────

export function PendingUpdateCard({
  count,
  summary,
  fileName,
  updateType,
  oldContent,
  newContent,
  active,
  onAccept,
  onReject,
  onFeedback,
  width,
}: {
  count: number;
  summary: string;
  fileName: string;
  updateType: "edit" | "new";
  oldContent?: string;
  newContent: string;
  active: boolean;
  onAccept: () => void;
  onReject: () => void;
  onFeedback: (feedback: string) => void;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const innerWidth = borderedContentWidth(contentWidth);
  const bodyWidth = indentedWidth(innerWidth);

  const diffLines = useMemo(
    () => computeDiffLines(oldContent, newContent, fileName),
    [oldContent, newContent, fileName],
  );

  const truncated = diffLines.length > MAX_DIFF_LINES;
  const visibleLines = truncated ? diffLines.slice(0, MAX_DIFF_LINES) : diffLines;
  const additions = diffLines.filter((l) => l.type === "add").length;
  const deletions = diffLines.filter((l) => l.type === "del").length;

  const options = [
    { label: "Accept", description: "Apply this update" },
    { label: "Reject", description: "Discard this update" },
  ];
  const totalItems = options.length + 1; // +1 for "Give feedback..."
  const feedbackIndex = options.length;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"selecting" | "typing">("selecting");
  const [feedbackText, setFeedbackText] = useState("");

  // Selection mode: arrow keys navigate, Enter picks option or enters typing mode
  useInput((input, key) => {
    if (!active || mode !== "selecting") return;
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(totalItems - 1, i + 1));
      return;
    }
    if (key.return) {
      if (selectedIndex === 0) { onAccept(); return; }
      if (selectedIndex === 1) { onReject(); return; }
      if (selectedIndex === feedbackIndex) {
        setMode("typing");
        setFeedbackText("");
      }
      return;
    }
  }, { isActive: active && mode === "selecting" });

  // Typing mode: inline text editing within the card
  useInput((input, key) => {
    if (!active || mode !== "typing") return;
    if (key.escape) {
      setMode("selecting");
      setFeedbackText("");
      return;
    }
    if (key.return) {
      if (feedbackText.trim()) {
        onFeedback(feedbackText.trim());
        setFeedbackText("");
        setMode("selecting");
      }
      return;
    }
    if (key.backspace || key.delete) {
      setFeedbackText((t) => t.slice(0, -1));
      return;
    }
    if (key.ctrl && input === "u") {
      setFeedbackText("");
      return;
    }
    if (!key.ctrl && !key.meta && !key.tab && input.length === 1 && input >= " ") {
      setFeedbackText((t) => t + input);
    }
  }, { isActive: active && mode === "typing" });

  const isFeedbackSelected = selectedIndex === feedbackIndex;
  const lineNumWidth = Math.max(3, String(diffLines.length).length + 1);
  const diffContentWidth = Math.max(1, bodyWidth - lineNumWidth - 3); // "+" prefix + space

  return (
    <Box
      borderStyle="single"
      borderColor={theme.warning}
      paddingX={1}
      marginBottom={0}
      flexDirection="column"
      width={contentWidth}
    >
      {/* Header */}
      <Box width={innerWidth}>
        <Text color={theme.pending} bold>{GUTTER.pending} </Text>
        <Text bold color={theme.pending}>{count} update{count > 1 ? "s" : ""} awaiting review</Text>
      </Box>
      <Box marginLeft={2} marginTop={0} width={bodyWidth}>
        <Text color={theme.muted} wrap="wrap">{summary}</Text>
        <Text color={theme.muted} dimColor>{"  "}</Text>
        {additions > 0 && <Text color={theme.secondary}>+{additions}</Text>}
        {additions > 0 && deletions > 0 && <Text color={theme.muted} dimColor> </Text>}
        {deletions > 0 && <Text color={theme.error}>-{deletions}</Text>}
      </Box>

      {/* Diff view */}
      <Box flexDirection="column" marginLeft={2} marginTop={1} width={bodyWidth}>
        {visibleLines.map((line, i) => {
          const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
          const color = line.type === "add" ? theme.secondary : line.type === "del" ? theme.error : theme.muted;
          const dimmed = line.type === "ctx";
          const displayText = truncateToWidth(line.text, diffContentWidth);
          return (
            <Text key={i} color={color} dimColor={dimmed} wrap="truncate-end">
              {prefix} {displayText}
            </Text>
          );
        })}
        {truncated && (
          <Text color={theme.muted} dimColor>  ··· {diffLines.length - MAX_DIFF_LINES} more lines</Text>
        )}
      </Box>

      {/* Options list */}
      <Box flexDirection="column" marginLeft={2} marginTop={1} width={bodyWidth}>
        {options.map((opt, idx) => {
          const isSelected = active && mode === "selecting" && idx === selectedIndex;
          const optColor = idx === 0 ? theme.secondary : theme.error;
          return (
            <Box key={opt.label} width={bodyWidth}>
              {isSelected ? (
                <>
                  <Text inverse bold color={theme.accent}>{" \u203A "}</Text>
                  <Text inverse bold>{" " + opt.label + " "}</Text>
                  <Text color={theme.muted} dimColor> — {opt.description}</Text>
                </>
              ) : (
                <>
                  <Text color={theme.muted}>{"   "}</Text>
                  <Text color={optColor}>{opt.label}</Text>
                  <Text color={theme.muted} dimColor> — {opt.description}</Text>
                </>
              )}
            </Box>
          );
        })}
        {/* Give feedback row */}
        {mode === "typing" ? (
          <Box width={bodyWidth}>
            <Text color={theme.accent} bold>{" \u203A "}</Text>
            <Text color={theme.text}>{feedbackText}</Text>
            <Text color={theme.accent}>{"\u2588"}</Text>
          </Box>
        ) : (
          <Box width={bodyWidth}>
            {active && isFeedbackSelected ? (
              <>
                <Text inverse bold color={theme.accent}>{" \u203A "}</Text>
                <Text inverse bold color={theme.muted}>{" Give feedback... "}</Text>
              </>
            ) : (
              <>
                <Text color={theme.muted}>{"   "}</Text>
                <Text color={theme.muted} dimColor>Give feedback...</Text>
              </>
            )}
          </Box>
        )}
      </Box>
      {/* Hint */}
      <Box marginLeft={2} marginTop={0} width={bodyWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">
          {mode === "typing"
            ? "Type your feedback \u00B7 Enter submit \u00B7 Esc back"
            : active
              ? "\u2191/\u2193 select \u00B7 Enter confirm"
              : "Waiting..."
          }
        </Text>
      </Box>
    </Box>
  );
}

// ── Question Card ───────────────────────────────────────────────────────────

export function QuestionCard({
  question,
  options,
  active,
  onSelect,
  width,
}: {
  question: string;
  options: Array<{ label: string; description: string }>;
  active: boolean;
  onSelect: (answer: string, isCustom: boolean) => void;
  width?: number;
}) {
  const theme = useTheme();
  const contentWidth = resolveWidth(width);
  const innerWidth = borderedContentWidth(contentWidth);
  const bodyWidth = indentedWidth(innerWidth);

  // Total items = options + "Custom answer..." row (only if there are predefined options)
  const hasOptions = options.length > 0;
  const totalItems = hasOptions ? options.length + 1 : 0;
  const customIndex = options.length; // last item in list
  const [selectedIndex, setSelectedIndex] = useState(0);
  // If no predefined options, start directly in typing mode
  const [mode, setMode] = useState<"selecting" | "typing">(hasOptions ? "selecting" : "typing");
  const [customText, setCustomText] = useState("");

  // Selection mode: arrow keys navigate, Enter picks option or enters typing mode
  useInput((input, key) => {
    if (!active || mode !== "selecting" || !hasOptions) return;
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(totalItems - 1, i + 1));
      return;
    }
    if (key.return) {
      if (selectedIndex < options.length) {
        // Selected a predefined option
        const picked = options[selectedIndex];
        if (picked) onSelect(picked.label, false);
      } else {
        // Selected "Custom answer..." — enter typing mode
        setMode("typing");
        setCustomText("");
      }
      return;
    }
  }, { isActive: active && mode === "selecting" });

  // Typing mode: inline text editing within the card
  useInput((input, key) => {
    if (!active || mode !== "typing") return;
    if (key.escape && hasOptions) {
      // Back to selection mode (only if there are predefined options to go back to)
      setMode("selecting");
      setCustomText("");
      return;
    }
    if (key.return) {
      if (customText.trim()) {
        onSelect(customText.trim(), true);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setCustomText((t) => t.slice(0, -1));
      return;
    }
    if (key.ctrl && input === "u") {
      setCustomText("");
      return;
    }
    // Regular character input
    if (!key.ctrl && !key.meta && !key.tab && input.length === 1 && input >= " ") {
      setCustomText((t) => t + input);
    }
  }, { isActive: active && mode === "typing" });

  const isCustomSelected = selectedIndex === customIndex;

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
      {/* Options list */}
      <Box flexDirection="column" marginLeft={2} marginTop={1} width={bodyWidth}>
        {options.map((opt, idx) => {
          const isSelected = active && mode === "selecting" && idx === selectedIndex;
          return (
            <Box key={opt.label} width={bodyWidth}>
              {isSelected ? (
                <>
                  <Text inverse bold color={theme.accent}>{" \u203A "}</Text>
                  <Text inverse bold>{" " + opt.label + " "}</Text>
                  <Text color={theme.muted} dimColor> — {opt.description}</Text>
                </>
              ) : (
                <>
                  <Text color={theme.muted}>{"   "}</Text>
                  <Text color={theme.text}>{opt.label}</Text>
                  <Text color={theme.muted} dimColor> — {opt.description}</Text>
                </>
              )}
            </Box>
          );
        })}
        {/* Custom answer row */}
        {mode === "typing" ? (
          <Box width={bodyWidth}>
            <Text color={theme.accent} bold>{" \u203A "}</Text>
            <Text color={theme.text}>{customText}</Text>
            <Text color={theme.accent}>{"\u2588"}</Text>
          </Box>
        ) : (
          <Box width={bodyWidth}>
            {active && isCustomSelected ? (
              <>
                <Text inverse bold color={theme.accent}>{" \u203A "}</Text>
                <Text inverse bold color={theme.muted}>{" Custom answer... "}</Text>
              </>
            ) : (
              <>
                <Text color={theme.muted}>{"   "}</Text>
                <Text color={theme.muted} dimColor>Custom answer...</Text>
              </>
            )}
          </Box>
        )}
      </Box>
      {/* Hint */}
      <Box marginLeft={2} marginTop={0} width={bodyWidth}>
        <Text color={theme.muted} dimColor wrap="wrap">
          {mode === "typing"
            ? "Type your answer \u00B7 Enter submit \u00B7 Esc back"
            : active
              ? "\u2191/\u2193 select \u00B7 Enter confirm"
              : "Waiting..."
          }
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
}) {
  const theme = useTheme();
  const modeLabel = mode === "auto-approve" ? "approve" : "review";
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
  const bottomLeft = `${modeLabel} · shift+tab cycle · /help`;
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
