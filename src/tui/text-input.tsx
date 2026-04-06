import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onTab?: () => void;
  onUpArrow?: () => void;
  onDownArrow?: () => void;
  placeholder?: string;
  focus?: boolean;
  showCursor?: boolean;
  /** Increment this number to force-move the cursor to end of value. */
  cursorToEnd?: number;
}

/**
 * Find the offset of the previous word boundary (for Option+Backspace / Ctrl+W).
 * Skips trailing whitespace, then skips the word.
 */
function prevWordBoundary(value: string, cursor: number): number {
  let i = cursor;
  // skip whitespace to the left
  while (i > 0 && /\s/.test(value[i - 1]!)) i--;
  // skip word chars to the left
  while (i > 0 && !/\s/.test(value[i - 1]!)) i--;
  return i;
}

/**
 * Find the offset of the next word boundary (for Option+Delete / Ctrl+D-word).
 */
function nextWordBoundary(value: string, cursor: number): number {
  let i = cursor;
  // skip word chars to the right
  while (i < value.length && !/\s/.test(value[i]!)) i++;
  // skip whitespace to the right
  while (i < value.length && /\s/.test(value[i]!)) i++;
  return i;
}

export default function TextInput({
  value: originalValue,
  onChange,
  onSubmit,
  onTab,
  onUpArrow,
  onDownArrow,
  placeholder = "",
  focus = true,
  showCursor = true,
  cursorToEnd = 0,
}: TextInputProps) {
  const [cursorOffset, setCursorOffset] = useState(originalValue.length);

  useEffect(() => {
    if (!focus || !showCursor) return;
    if (cursorOffset > originalValue.length) {
      setCursorOffset(originalValue.length);
    }
  }, [originalValue, focus, showCursor]);

  // Move cursor to end when parent signals (e.g. after autocomplete)
  useEffect(() => {
    if (cursorToEnd > 0) {
      setCursorOffset(originalValue.length);
    }
  }, [cursorToEnd]);

  // Build a rendered string with a fake cursor baked in
  function buildRendered(): string {
    if (showCursor && focus) {
      if (originalValue.length === 0) return chalk.inverse(" ");

      let result = "";
      let i = 0;
      for (const char of originalValue) {
        if (i === cursorOffset) {
          result += char === "\n" ? chalk.inverse(" ") + "\n" : chalk.inverse(char);
        } else {
          result += char;
        }
        i++;
      }
      if (cursorOffset === originalValue.length) {
        result += chalk.inverse(" ");
      }
      return result;
    }
    return originalValue;
  }

  const renderedPlaceholder =
    showCursor && focus && placeholder.length > 0
      ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
      : placeholder
        ? chalk.grey(placeholder)
        : undefined;

  useInput(
    (input, key) => {
      // Pass-through keys we don't handle
      if ((key.ctrl && input === "c") || (key.shift && key.tab)) {
        return;
      }

      if (key.upArrow) {
        onUpArrow?.();
        return;
      }
      if (key.downArrow) {
        onDownArrow?.();
        return;
      }

      if (key.tab) {
        onTab?.();
        return;
      }

      // Newline insertion: Shift+Enter (kitty terminals) OR Alt+Enter (universal)
      if ((key.return && key.shift) || (key.return && key.meta)) {
        const inserted =
          originalValue.slice(0, cursorOffset) +
          "\n" +
          originalValue.slice(cursorOffset);
        setCursorOffset(cursorOffset + 1);
        onChange(inserted);
        return;
      }

      if (key.return) {
        onSubmit?.(originalValue);
        return;
      }

      let nextValue = originalValue;
      let nextCursor = cursorOffset;

      // ── Delete word backward: Option+Backspace or Ctrl+W ──
      if (
        (key.meta && key.backspace) ||
        (key.ctrl && input === "w")
      ) {
        const boundary = prevWordBoundary(originalValue, cursorOffset);
        nextValue =
          originalValue.slice(0, boundary) +
          originalValue.slice(cursorOffset);
        nextCursor = boundary;
      }
      // ── Delete to start of line: Ctrl+U ──
      else if (key.ctrl && input === "u") {
        nextValue = originalValue.slice(cursorOffset);
        nextCursor = 0;
      }
      // ── Delete to end of line: Ctrl+K ──
      else if (key.ctrl && input === "k") {
        nextValue = originalValue.slice(0, cursorOffset);
        // cursor stays
      }
      // ── Delete word forward: Option+Delete or Ctrl+D with meta ──
      else if (key.meta && key.delete) {
        const boundary = nextWordBoundary(originalValue, cursorOffset);
        nextValue =
          originalValue.slice(0, cursorOffset) +
          originalValue.slice(boundary);
      }
      // ── Single char backspace ──
      else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          nextValue =
            originalValue.slice(0, cursorOffset - 1) +
            originalValue.slice(cursorOffset);
          nextCursor--;
        }
      }
      // ── Move word left: Option+Left or ESC+b or Ctrl+Left ──
      else if (
        (key.meta && key.leftArrow) ||
        (key.meta && input === "b") ||
        (key.ctrl && key.leftArrow)
      ) {
        nextCursor = prevWordBoundary(originalValue, cursorOffset);
      }
      // ── Move word right: Option+Right or ESC+f or Ctrl+Right ──
      else if (
        (key.meta && key.rightArrow) ||
        (key.meta && input === "f") ||
        (key.ctrl && key.rightArrow)
      ) {
        nextCursor = nextWordBoundary(originalValue, cursorOffset);
      }
      // ── Move to start: Ctrl+A or Home ──
      else if ((key.ctrl && input === "a") || key.home) {
        nextCursor = 0;
      }
      // ── Move to end: Ctrl+E or End ──
      else if ((key.ctrl && input === "e") || key.end) {
        nextCursor = originalValue.length;
      }
      // ── Arrow left ──
      else if (key.leftArrow) {
        if (showCursor) nextCursor--;
      }
      // ── Arrow right ──
      else if (key.rightArrow) {
        if (showCursor) nextCursor++;
      }
      // ── Regular character input ──
      else if (!key.ctrl && !key.meta) {
        // Strip terminal escape sequences:
        // - CSI sequences: ESC [ ... letter/tilde (covers bracketed paste markers [200~ / [201~)
        // - OSC sequences: ESC ] ... BEL/ST
        // - Lone ESC prefix leftovers
        // Then strip control characters (except \t and \n which are valid in multiline input)
        const clean = input
          .replace(/\x1b\[[?>=!]*[0-9;]*[a-zA-Z~]/g, "")
          .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
          .replace(/\[20[01]~/g, "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
        if (clean) {
          nextValue =
            originalValue.slice(0, cursorOffset) +
            clean +
            originalValue.slice(cursorOffset);
          nextCursor += clean.length;
        }
      }
      // Ignore other ctrl/meta combos we don't handle

      // Clamp cursor
      nextCursor = Math.max(0, Math.min(nextCursor, nextValue.length));

      setCursorOffset(nextCursor);
      if (nextValue !== originalValue) {
        onChange(nextValue);
      }
    },
    { isActive: focus }
  );

  if (originalValue.length === 0 && renderedPlaceholder) {
    return <Text>{renderedPlaceholder}</Text>;
  }

  const rendered = buildRendered();
  const lines = rendered.split("\n");

  if (lines.length === 1) {
    return <Text>{rendered}</Text>;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line || " "}</Text>
      ))}
    </Box>
  );
}
