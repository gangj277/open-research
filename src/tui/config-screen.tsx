import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

// ── Config item definition ────────────────────────────────────────────────

export interface ConfigItem {
  key: string;
  label: string;
  values: string[];
  current: string;
}

export interface ConfigScreenProps {
  items: ConfigItem[];
  onUpdate: (key: string, value: string) => void;
  onClose: () => void;
}

// ── ConfigScreen ──────────────────────────────────────────────────────────

export function ConfigScreen({ items, onUpdate, onClose }: ConfigScreenProps) {
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const search = filter.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(search) ||
        item.key.toLowerCase().includes(search) ||
        item.current.toLowerCase().includes(search)
    );
  }, [items, filter]);

  // Clamp selected index when filter changes
  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onClose();
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
      const item = filtered[clampedIndex];
      if (!item) return;
      const currentValueIndex = item.values.indexOf(item.current);
      const nextIndex = (currentValueIndex + 1) % item.values.length;
      onUpdate(item.key, item.values[nextIndex]!);
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

    // Regular character input
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

  const terminalWidth = process.stdout.columns ?? 100;
  const labelWidth = Math.max(32, Math.floor(terminalWidth * 0.4));

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Text bold color="cyan">
        /config
      </Text>
      <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="gray">{"\u2315 "}</Text>
        <Text>{filter || <Text color="gray">Search settings...</Text>}</Text>
      </Box>

      {/* Settings list */}
      <Box marginTop={1} flexDirection="column">
        {filtered.length === 0 ? (
          <Text color="gray">No matching settings.</Text>
        ) : (
          filtered.map((item, index) => {
            const isSelected = index === clampedIndex;
            return (
              <Box key={item.key} paddingX={2}>
                <Box width={labelWidth}>
                  <Text color={isSelected ? "cyan" : "white"}>
                    {isSelected ? ">" : " "} {item.label}
                  </Text>
                </Box>
                <Text color={isSelected ? "green" : "gray"}>
                  {item.current}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Footer hints */}
      <Box marginTop={1}>
        <Text color="gray">
          Type to filter  {"\u00B7"}  Enter to change  {"\u00B7"}  {"\u2191"}/{"\u2193"} to select  {"\u00B7"}  Esc to close
        </Text>
      </Box>
    </Box>
  );
}
