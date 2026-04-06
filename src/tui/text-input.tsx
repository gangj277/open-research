import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";

/** Placeholder character for collapsed paste chunks in the value string. */
const PASTE_MARKER = "\uFFFC";

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

/** Expand all paste markers in a string back to their original content. */
function expandPasteMarkers(
  value: string,
  pasteMap: Map<number, { text: string }>
): string {
  let result = "";
  let pasteIdx = 0;
  const ids = [...pasteMap.keys()].sort((a, b) => a - b);
  for (const char of value) {
    if (char === PASTE_MARKER && pasteIdx < ids.length) {
      const entry = pasteMap.get(ids[pasteIdx]!);
      result += entry?.text ?? "";
      pasteIdx++;
    } else {
      result += char;
    }
  }
  return result;
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
  const pasteMapRef = useRef<Map<number, { text: string; lineCount: number; id: number }>>(new Map());
  const pasteCounterRef = useRef(0);

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

  // Clean up paste map when value is cleared
  useEffect(() => {
    if (originalValue === "") {
      pasteMapRef.current.clear();
    }
  }, [originalValue]);

  // Build a paste badge string
  function pasteBadge(entry: { id: number; lineCount: number }): string {
    return chalk.dim.cyan(`[Pasted text #${entry.id} +${entry.lineCount} lines]`);
  }

  // Build a rendered string with a fake cursor and paste badges
  function buildRendered(): string {
    if (showCursor && focus) {
      if (originalValue.length === 0) return chalk.inverse(" ");

      // Collect paste IDs in order of appearance
      const pasteIds = [...pasteMapRef.current.keys()].sort((a, b) => a - b);
      let pasteIdx = 0;

      let result = "";
      let i = 0;
      for (const char of originalValue) {
        if (char === PASTE_MARKER) {
          const entry = pasteIdx < pasteIds.length ? pasteMapRef.current.get(pasteIds[pasteIdx]!) : undefined;
          pasteIdx++;
          if (i === cursorOffset) {
            result += entry ? pasteBadge(entry) + chalk.inverse(" ") : chalk.inverse(" ");
          } else {
            result += entry ? pasteBadge(entry) : "";
          }
        } else if (i === cursorOffset) {
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
    // Not focused — still render paste badges
    let result = "";
    const pasteIds = [...pasteMapRef.current.keys()].sort((a, b) => a - b);
    let pasteIdx = 0;
    for (const char of originalValue) {
      if (char === PASTE_MARKER) {
        const entry = pasteIdx < pasteIds.length ? pasteMapRef.current.get(pasteIds[pasteIdx]!) : undefined;
        pasteIdx++;
        result += entry ? pasteBadge(entry) : "";
      } else {
        result += char;
      }
    }
    return result;
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
        // Expand paste markers back to full content before submitting
        const expanded = expandPasteMarkers(originalValue, pasteMapRef.current);
        onSubmit?.(expanded);
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
          // If deleting a paste marker, remove from paste map
          const deletedChar = originalValue[cursorOffset - 1];
          if (deletedChar === PASTE_MARKER) {
            // Find which paste ID corresponds to this marker position
            let markerIndex = 0;
            for (let ci = 0; ci < cursorOffset - 1; ci++) {
              if (originalValue[ci] === PASTE_MARKER) markerIndex++;
            }
            const ids = [...pasteMapRef.current.keys()].sort((a, b) => a - b);
            if (markerIndex < ids.length) {
              pasteMapRef.current.delete(ids[markerIndex]!);
            }
          }
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
        // Strip terminal escape sequences and control chars
        const clean = input
          .replace(/\x1b\[[?>=!]*[0-9;]*[a-zA-Z~]/g, "")
          .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
          .replace(/\[20[01]~/g, "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
        if (clean) {
          const lineCount = (clean.match(/\n/g) || []).length;
          // Multi-line paste: collapse to a single marker character
          if (lineCount >= 2) {
            const id = ++pasteCounterRef.current;
            pasteMapRef.current.set(id, { text: clean, lineCount, id });
            nextValue =
              originalValue.slice(0, cursorOffset) +
              PASTE_MARKER +
              originalValue.slice(cursorOffset);
            nextCursor += 1;
          } else {
            nextValue =
              originalValue.slice(0, cursorOffset) +
              clean +
              originalValue.slice(cursorOffset);
            nextCursor += clean.length;
          }
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
