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

  // Clamp selection
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

    // Ctrl+U clears filter
    if (key.ctrl && input === "u") {
      setFilter("");
      setSelectedIndex(0);
      return;
    }

    // Regular character input for search
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

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">Resume Session</Text>

      {/* Search box */}
      <Box
        borderStyle="single"
        borderColor={filter ? "cyan" : "gray"}
        paddingX={1}
        marginTop={1}
        marginBottom={1}
      >
        <Text color="gray">
          {filter ? filter : "Type to search..."}
        </Text>
      </Box>

      {/* Session list */}
      {filtered.length === 0 ? (
        <Text color="gray">{filter ? "No matching sessions." : "No sessions found."}</Text>
      ) : (
        <Box flexDirection="column">
          {filtered.slice(0, 15).map((session, idx) => {
            const isSelected = idx === clampedIndex;
            const indicator = isSelected ? "›" : " ";
            const preview = session.preview || "(empty session)";
            const age = timeAgo(session.lastActivity);
            const turns = `${session.turnCount} turn${session.turnCount !== 1 ? "s" : ""}`;

            return (
              <Box key={session.id} flexDirection="column" marginBottom={isSelected ? 1 : 0}>
                <Box>
                  <Text color={isSelected ? "cyan" : "gray"}>{indicator} </Text>
                  <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
                    {preview.length > 70 ? preview.slice(0, 70) + "…" : preview}
                  </Text>
                </Box>
                {isSelected && (
                  <Box marginLeft={2}>
                    <Text color="gray" dimColor>
                      {age} · {turns} · {session.id.slice(0, 8)}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ navigate · Enter select · Type to search · Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
