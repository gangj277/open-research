import React from "react";
import { Box, Text } from "ink";
import { renderMarkdown } from "@/tui/markdown";
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

// ── Divider ─────────────────────────────────────────────────────────────────

export function Divider({ width, color = "gray" }: { width?: number; color?: string }) {
  const w = width ?? (process.stdout.columns ?? 80) - 4;
  return <Text color={color} dimColor>{"─".repeat(Math.max(1, w))}</Text>;
}

// ── Message Components ──────────────────────────────────────────────────────

export function UserMessage({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>{GUTTER.user} </Text>
        <Text bold color="cyan">you</Text>
      </Box>
      <Box marginLeft={2}>
        <Text>{text}</Text>
      </Box>
    </Box>
  );
}

export function AgentMessage({ text }: { text: string }) {
  const rendered = renderMarkdown(text);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="green" bold>{GUTTER.agent} </Text>
        <Text bold color="green">agent</Text>
      </Box>
      <Box marginLeft={2}>
        <Text>{rendered}</Text>
      </Box>
    </Box>
  );
}

export function SystemMessage({ text }: { text: string }) {
  // Tool activity lines (✓ prefix) get special treatment
  if (text.trimStart().startsWith("✓") || text.trimStart().startsWith("✗")) {
    return (
      <Box marginLeft={2}>
        <Text color="gray" dimColor>{text}</Text>
      </Box>
    );
  }
  // Compaction notices
  if (text.includes("compacted") || text.includes("Context")) {
    return (
      <Box marginLeft={2}>
        <Text color="yellow" dimColor>{GUTTER.system} {text.trim()}</Text>
      </Box>
    );
  }
  // Command echoes (> /auth etc)
  if (text.trimStart().startsWith(">")) {
    return (
      <Box>
        <Text color="gray" dimColor>{text}</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text color="gray">{GUTTER.system} {text.trim()}</Text>
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
  if (hasQuestion) {
    return <Text color="yellow">{GUTTER.question} </Text>;
  }
  if (busy) {
    return <Text color="yellow">{frame} </Text>;
  }
  return <Text color="cyan">{GUTTER.user} </Text>;
}

// ── Status Badge ────────────────────────────────────────────────────────────

export function StatusBadge({
  label,
  color = "gray",
  dimmed = false,
}: {
  label: string;
  color?: string;
  dimmed?: boolean;
}) {
  return (
    <Text color={color} dimColor={dimmed}>
      {label}
    </Text>
  );
}

// ── Pending Update Card ─────────────────────────────────────────────────────

export function PendingUpdateCard({
  count,
  summary,
}: {
  count: number;
  summary: string;
}) {
  return (
    <Box
      borderStyle="single"
      borderColor="magenta"
      paddingX={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Box>
        <Text color="magenta" bold>{GUTTER.pending} </Text>
        <Text bold color="magenta">{count} update{count > 1 ? "s" : ""} awaiting review</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray">{summary}</Text>
      </Box>
      <Box marginLeft={2} marginTop={0}>
        <Text color="gray" dimColor>
          <Text bold color="green">a</Text> accept  <Text bold color="red">r</Text> reject
        </Text>
      </Box>
    </Box>
  );
}

// ── Question Card ───────────────────────────────────────────────────────────

export function QuestionCard({
  question,
  options,
}: {
  question: string;
  options: Array<{ label: string; description: string }>;
}) {
  return (
    <Box
      borderStyle="single"
      borderColor="yellow"
      paddingX={1}
      marginBottom={0}
      flexDirection="column"
    >
      <Box>
        <Text color="yellow" bold>{GUTTER.question} </Text>
        <Text bold color="yellow">Agent needs your input</Text>
      </Box>
      <Box marginLeft={2} marginTop={0}>
        <Text>{question}</Text>
      </Box>
      {options.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {options.map((opt, idx) => (
            <Box key={opt.label}>
              <Text color="cyan" bold>{idx + 1}</Text>
              <Text> {opt.label}</Text>
              <Text color="gray" dimColor> — {opt.description}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box marginLeft={2} marginTop={0}>
        <Text color="gray" dimColor>
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
}: {
  hasAuth: boolean;
  hasWorkspace: boolean;
  fileCount: number;
  skillCount: number;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Open Research</Text>
        <Text color="gray" dimColor>Local-first research agent</Text>
      </Box>

      {!hasAuth && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">{GUTTER.pending} </Text>
            <Text color="yellow">Connect your OpenAI account to get started</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="gray">/auth — browser login  ·  /auth-codex — import existing session</Text>
          </Box>
        </Box>
      )}

      {hasAuth && !hasWorkspace && (
        <Box flexDirection="column">
          <Box>
            <Text color="green">{GUTTER.success} </Text>
            <Text color="green">Connected</Text>
          </Box>
          <Box>
            <Text color="yellow">{GUTTER.pending} </Text>
            <Text color="yellow">Create a workspace to begin</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="gray">/init — initialize in current directory</Text>
          </Box>
        </Box>
      )}

      {hasAuth && hasWorkspace && (
        <Box flexDirection="column">
          <Box>
            <Text color="green">{GUTTER.active} </Text>
            <Text color="green">Ready</Text>
            <Text color="gray" dimColor> — {fileCount} files · {skillCount} skills</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="gray">Ask a question, @mention a file, or /help for commands</Text>
          </Box>
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
}: {
  items: SuggestionItem[];
  selectedIndex: number;
}) {
  if (items.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginBottom={0}
    >
      {items.slice(0, 8).map((s, idx) => {
        const selected = idx === selectedIndex;
        const prefix = selected ? "›" : " ";

        if (s.kind === "file") {
          return selected ? (
            <Box key={`file-${s.path}`}>
              <Text inverse bold>{` ${prefix} @${s.path} `}</Text>
            </Box>
          ) : (
            <Box key={`file-${s.path}`}>
              <Text color="gray">{prefix} </Text>
              <Text color="green">@{s.path}</Text>
            </Box>
          );
        }

        const nameColor = s.kind === "skill" ? "magenta" : "cyan";
        const badge = s.kind === "skill" ? " [skill]" : "";
        const label = `/${s.name}${badge} — ${s.description}`;

        return selected ? (
          <Box key={`${s.kind}-${s.name}`}>
            <Text inverse bold>{` ${prefix} ${label} `}</Text>
          </Box>
        ) : (
          <Box key={`${s.kind}-${s.name}`}>
            <Text color="gray">{prefix} </Text>
            <Text color={nameColor}>/{s.name}</Text>
            <Text color="gray" dimColor>{badge} — {s.description}</Text>
          </Box>
        );
      })}
      <Text color="gray" dimColor> ↑↓ navigate · enter select · tab complete</Text>
    </Box>
  );
}

// ── Footer Status Bar ───────────────────────────────────────────────────────

export function FooterBar({
  busy,
  frame,
  toolActivity,
  statusParts,
  statusColor,
  tokenDisplay,
  workspaceName,
  mode,
  planningStatus,
}: {
  busy: boolean;
  frame: string;
  toolActivity: string;
  statusParts: string[];
  statusColor: string;
  tokenDisplay: string;
  workspaceName: string;
  mode: string;
  planningStatus: string;
}) {
  const modeLabel = mode === "auto-research" ? "auto" : mode === "auto-approve" ? "approve" : "review";
  const planLabel = planningStatus !== "idle" ? ` · ${planningStatus}` : "";

  return (
    <Box flexDirection="column" marginTop={0}>
      <Box justifyContent="space-between">
        <Text color={statusColor}>
          {busy
            ? toolActivity
              ? `${frame} ${toolActivity}`
              : `${frame} thinking...`
            : `${GUTTER.active} ${statusParts.join(" · ")}`}
        </Text>
        <Text color="gray" dimColor>
          {tokenDisplay ? `${tokenDisplay} · ` : ""}{workspaceName}
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color="gray" dimColor>
          {modeLabel}{planLabel} · shift+tab cycle · /help
        </Text>
        <Text color="gray" dimColor>
          shift+enter newline · esc cancel
        </Text>
      </Box>
    </Box>
  );
}
