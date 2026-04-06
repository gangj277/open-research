import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SavedSession } from "@/lib/workspace/sessions";

export interface SessionPickerProps {
  sessions: SavedSession[];
  onSelect: (session: SavedSession) => void;
  onCancel: () => void;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
}

export function SessionPicker({ sessions, onSelect, onCancel }: SessionPickerProps) {
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!filter) return sessions;
    const search = filter.toLowerCase();
    return sessions.filter(
      (s) =>
        s.preview.toLowerCase().includes(search) ||
        s.id.toLowerCase().includes(search)
    );
  }, [sessions, filter]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }

    if (key.return && filtered.length > 0) {
      onSelect(filtered[clampedIndex]!);
      return;
    }

    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (key.ctrl && input === "u") {
      setFilter("");
      setSelectedIndex(0);
      return;
    }

    if (
      !key.ctrl &&
      !key.meta &&
      !key.tab &&
      input.length === 1 &&
      input >= " "
    ) {
      setFilter((f) => f + input);
      setSelectedIndex(0);
    }
  });

  const width = Math.max(60, (process.stdout.columns ?? 80) - 6);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Text bold>/resume</Text>
      <Text color="gray" dimColor>
        {sessions.length} session{sessions.length !== 1 ? "s" : ""} in this workspace
      </Text>

      {/* Search box */}
      <Box
        borderStyle="round"
        borderColor={filter ? "cyan" : "gray"}
        paddingX={1}
        marginTop={1}
        marginBottom={1}
      >
        <Text color="gray">{"\u2315"} </Text>
        <Text>{filter || <Text color="gray">Search sessions...</Text>}</Text>
      </Box>

      {/* Session list */}
      {filtered.length === 0 ? (
        <Text color="gray">{filter ? "No matching sessions." : "No sessions found."}</Text>
      ) : (
        <Box flexDirection="column">
          {filtered.slice(0, 12).map((session, idx) => {
            const isSelected = idx === clampedIndex;
            const preview = session.preview || "(empty session)";
            const age = timeAgo(session.lastActivity);
            const turns = `${session.turnCount} turn${session.turnCount !== 1 ? "s" : ""}`;
            const meta = `${age} \u00B7 ${turns}`;

            if (isSelected) {
              // Selected row: inverse highlight — always visible
              const line = ` \u203A ${truncate(preview, width - meta.length - 8)}`;
              return (
                <Box key={session.id} flexDirection="column" marginBottom={0}>
                  <Box>
                    <Text inverse bold>{line}</Text>
                    <Text inverse dimColor>{` ${meta} `}</Text>
                  </Box>
                  <Box marginLeft={3}>
                    <Text color="gray" dimColor>id: {session.id.slice(0, 8)} \u00B7 started {new Date(session.startedAt).toLocaleString()}</Text>
                  </Box>
                </Box>
              );
            }

            return (
              <Box key={session.id}>
                <Text color="gray">{"  "}</Text>
                <Text>{truncate(preview, width - meta.length - 8)}</Text>
                <Text color="gray" dimColor>{` ${meta}`}</Text>
              </Box>
            );
          })}
          {filtered.length > 12 && (
            <Text color="gray" dimColor>  \u2193 {filtered.length - 12} more below</Text>
          )}
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          \u2191/\u2193 to select \u00B7 Enter resume \u00B7 Type to filter \u00B7 Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
