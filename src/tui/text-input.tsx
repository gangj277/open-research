import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout, measureElement } from "ink";
import type { DOMElement } from "ink";
import chalk from "chalk";
import wrapAnsi from "wrap-ansi";

/** Placeholder character for collapsed paste chunks in the value string. */
const PASTE_MARKER = "\uFFFC";
const BRACKETED_PASTE_START = "[200~";
const BRACKETED_PASTE_END = "[201~";

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
  accentColor?: string;
  mutedColor?: string;
}

type ChalkStyle = ((text: string) => string) & {
  hex: (color: string) => ChalkStyle;
  [key: string]: unknown;
};

function applyThemeColor(base: ChalkStyle, color: string | undefined, text: string): string {
  if (!color) {
    return base(text);
  }

  if (color.startsWith("#")) {
    return base.hex(color)(text);
  }

  const namedStyle = (base as Record<string, unknown>)[color];
  if (typeof namedStyle === "function") {
    return (namedStyle as ChalkStyle)(text);
  }

  return base(text);
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

type VisualLineRange = {
  start: number;
  end: number;
  removeStart: number;
  removeEnd: number;
};

function getVisualLineRanges(value: string, width: number): VisualLineRange[] {
  if (width <= 0) return [];

  const ranges: VisualLineRange[] = [];
  let index = 0;

  while (index <= value.length) {
    const newlineIndex = value.indexOf("\n", index);
    const hasNewline = newlineIndex !== -1;
    const logicalEnd = hasNewline ? newlineIndex : value.length;
    const segment = value.slice(index, logicalEnd);
    const wrapped = wrapAnsi(segment, width, { trim: false, hard: true });
    const parts = wrapped.split("\n");

    let consumed = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? "";
      const start = index + consumed;
      const end = start + part.length;
      consumed += part.length;

      ranges.push({
        start,
        end,
        removeStart: start,
        removeEnd: i === parts.length - 1 && hasNewline ? end + 1 : end,
      });
    }

    if (!hasNewline) break;
    index = logicalEnd + 1;
  }

  return ranges;
}

function deleteCurrentVisualLine(
  value: string,
  cursor: number,
  width: number,
): { nextValue: string; nextCursor: number } {
  const ranges = getVisualLineRanges(value, width);
  if (ranges.length === 0) {
    return { nextValue: value, nextCursor: cursor };
  }

  let target = ranges[ranges.length - 1]!;
  if (cursor < value.length) {
    for (let i = 0; i < ranges.length; i++) {
      const current = ranges[i]!;
      const next = ranges[i + 1];

      if (cursor < current.end) {
        target = current;
        break;
      }

      if (!next || cursor < next.start) {
        target = current;
        break;
      }
    }
  }

  const nextValue =
    value.slice(0, target.removeStart) +
    value.slice(target.removeEnd);
  const nextCursor = Math.min(target.removeStart, nextValue.length);

  return { nextValue, nextCursor };
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
  accentColor,
  mutedColor,
}: TextInputProps) {
  const containerRef = useRef<DOMElement | null>(null);
  const [cursorOffset, setCursorOffset] = useState(originalValue.length);
  const [inputWidth, setInputWidth] = useState(0);
  const valueRef = useRef(originalValue);
  const cursorOffsetRef = useRef(originalValue.length);
  const pasteMapRef = useRef<Map<number, { text: string; lineCount: number; id: number }>>(new Map());
  const pasteCounterRef = useRef(0);
  const bracketedPasteBufferRef = useRef<string | null>(null);
  const { stdout } = useStdout();

  useEffect(() => {
    valueRef.current = originalValue;
  }, [originalValue]);

  useEffect(() => {
    cursorOffsetRef.current = cursorOffset;
  }, [cursorOffset]);

  useEffect(() => {
    if (!focus || !showCursor) return;
    if (cursorOffset > originalValue.length) {
      cursorOffsetRef.current = originalValue.length;
      setCursorOffset(originalValue.length);
    }
  }, [originalValue, focus, showCursor]);

  // Move cursor to end when parent signals (e.g. after autocomplete)
  useEffect(() => {
    if (cursorToEnd > 0) {
      cursorOffsetRef.current = originalValue.length;
      setCursorOffset(originalValue.length);
    }
  }, [cursorToEnd]);

  // Clean up paste map when value is cleared
  useEffect(() => {
    if (originalValue === "") {
      pasteMapRef.current.clear();
    }
  }, [originalValue]);

  useEffect(() => {
    const fallbackWidth = stdout.columns ?? 0;
    if (!containerRef.current) {
      if (fallbackWidth > 0) {
        setInputWidth((current) => (current === fallbackWidth ? current : fallbackWidth));
      }
      return;
    }

    const measuredWidth = measureElement(containerRef.current).width;
    const nextWidth = measuredWidth > 0 ? measuredWidth : fallbackWidth;
    if (nextWidth > 0) {
      setInputWidth((current) => (current === nextWidth ? current : nextWidth));
    }
  });

  // Build a paste badge string
  function pasteBadge(entry: { id: number; lineCount: number }): string {
    return applyThemeColor(chalk.dim as ChalkStyle, accentColor, `[Pasted text #${entry.id} +${entry.lineCount} lines]`);
  }

  // Detect slash command token length: "/command" portion before first space
  function getSlashCommandEnd(): number {
    if (!originalValue.startsWith("/")) return 0;
    const spaceIdx = originalValue.indexOf(" ");
    return spaceIdx === -1 ? originalValue.length : spaceIdx;
  }

  // Build a rendered string with a fake cursor and paste badges
  function buildRendered(): string {
    const cmdEnd = getSlashCommandEnd();

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
          if (char === "\n") {
            result += chalk.inverse(" ") + "\n";
          } else if (cmdEnd > 0 && i < cmdEnd) {
            result += applyThemeColor(chalk.inverse as ChalkStyle, accentColor, char);
          } else {
            result += chalk.inverse(char);
          }
        } else if (cmdEnd > 0 && i < cmdEnd) {
          result += applyThemeColor(chalk as ChalkStyle, accentColor, char);
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
    let i = 0;
    for (const char of originalValue) {
      if (char === PASTE_MARKER) {
        const entry = pasteIdx < pasteIds.length ? pasteMapRef.current.get(pasteIds[pasteIdx]!) : undefined;
        pasteIdx++;
        result += entry ? pasteBadge(entry) : "";
      } else if (cmdEnd > 0 && i < cmdEnd) {
        result += applyThemeColor(chalk as ChalkStyle, accentColor, char);
      } else {
        result += char;
      }
      i++;
    }
    return result;
  }

  const renderedPlaceholder =
    showCursor && focus && placeholder.length > 0
      ? chalk.inverse(placeholder[0]) + applyThemeColor(chalk.dim as ChalkStyle, mutedColor, placeholder.slice(1))
      : placeholder
        ? applyThemeColor(chalk.dim as ChalkStyle, mutedColor, placeholder)
        : undefined;

  function sanitizeInput(raw: string): string {
    return raw
      .replace(/\x1b\[[?>=!]*[0-9;]*[a-zA-Z~]/g, "")
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
      .replace(/\[20[01]~/g, "")
      .replace(/\d+;\d+;\d+[~u]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  }

  function insertCleanText(
    raw: string,
    currentValue: string,
    currentCursor: number,
  ): { nextValue: string; nextCursor: number } {
    const clean = sanitizeInput(raw);
    if (!clean) {
      return { nextValue: currentValue, nextCursor: currentCursor };
    }

    const lineCount = (clean.match(/\n/g) || []).length;
    if (lineCount >= 2) {
      const id = ++pasteCounterRef.current;
      pasteMapRef.current.set(id, { text: clean, lineCount, id });
      return {
        nextValue:
          currentValue.slice(0, currentCursor) +
          PASTE_MARKER +
          currentValue.slice(currentCursor),
        nextCursor: currentCursor + 1,
      };
    }

    return {
      nextValue:
        currentValue.slice(0, currentCursor) +
        clean +
        currentValue.slice(currentCursor),
      nextCursor: currentCursor + clean.length,
    };
  }

  useInput(
    (input, key) => {
      const currentValue = valueRef.current;
      const currentCursor = cursorOffsetRef.current;

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

      // Newline insertion: Shift+Enter / Alt+Enter / Kitty Shift+Enter sequence
      if (
        (key.return && key.shift) ||
        (key.return && key.meta) ||
        input === "27;2;13~" ||
        input.includes("27;2;13")
      ) {
        const inserted =
          currentValue.slice(0, currentCursor) +
          "\n" +
          currentValue.slice(currentCursor);
        cursorOffsetRef.current = currentCursor + 1;
        valueRef.current = inserted;
        setCursorOffset(currentCursor + 1);
        onChange(inserted);
        return;
      }

      if (key.return) {
        // Expand paste markers back to full content before submitting
        const expanded = expandPasteMarkers(currentValue, pasteMapRef.current);
        onSubmit?.(expanded);
        return;
      }

      let nextValue = currentValue;
      let nextCursor = currentCursor;

      // ── Delete word backward: Option+Backspace or Ctrl+W ──
      if (
        (key.meta && key.backspace) ||
        (key.ctrl && input === "w")
      ) {
        const boundary = prevWordBoundary(currentValue, currentCursor);
        nextValue =
          currentValue.slice(0, boundary) +
          currentValue.slice(currentCursor);
        nextCursor = boundary;
      }
      // ── Delete current visual line: Ctrl+U / Cmd+Backspace ──
      else if (key.ctrl && input === "u") {
        const deleted = deleteCurrentVisualLine(
          currentValue,
          currentCursor,
          inputWidth,
        );
        nextValue = deleted.nextValue;
        nextCursor = deleted.nextCursor;
      }
      // ── Delete to end of line: Ctrl+K ──
      else if (key.ctrl && input === "k") {
        // Find the end of the current line (nearest \n after cursor, or end)
        const lineEnd = currentValue.indexOf("\n", currentCursor);
        nextValue =
          currentValue.slice(0, currentCursor) +
          (lineEnd === -1 ? "" : currentValue.slice(lineEnd));
      }
      // ── Delete word forward: Option+Delete or Ctrl+D with meta ──
      else if (key.meta && key.delete) {
        const boundary = nextWordBoundary(currentValue, currentCursor);
        nextValue =
          currentValue.slice(0, currentCursor) +
          currentValue.slice(boundary);
      }
      // ── Single char backspace ──
      else if (key.backspace || key.delete) {
        if (currentCursor > 0) {
          // If deleting a paste marker, remove from paste map
          const deletedChar = currentValue[currentCursor - 1];
          if (deletedChar === PASTE_MARKER) {
            // Find which paste ID corresponds to this marker position
            let markerIndex = 0;
            for (let ci = 0; ci < currentCursor - 1; ci++) {
              if (currentValue[ci] === PASTE_MARKER) markerIndex++;
            }
            const ids = [...pasteMapRef.current.keys()].sort((a, b) => a - b);
            if (markerIndex < ids.length) {
              pasteMapRef.current.delete(ids[markerIndex]!);
            }
          }
          nextValue =
            currentValue.slice(0, currentCursor - 1) +
            currentValue.slice(currentCursor);
          nextCursor--;
        }
      }
      // ── Move word left: Option+Left or ESC+b or Ctrl+Left ──
      else if (
        (key.meta && key.leftArrow) ||
        (key.meta && input === "b") ||
        (key.ctrl && key.leftArrow)
      ) {
        nextCursor = prevWordBoundary(currentValue, currentCursor);
      }
      // ── Move word right: Option+Right or ESC+f or Ctrl+Right ──
      else if (
        (key.meta && key.rightArrow) ||
        (key.meta && input === "f") ||
        (key.ctrl && key.rightArrow)
      ) {
        nextCursor = nextWordBoundary(currentValue, currentCursor);
      }
      // ── Move to start: Ctrl+A or Home ──
      else if ((key.ctrl && input === "a") || key.home) {
        nextCursor = 0;
      }
      // ── Move to end: Ctrl+E or End ──
      else if ((key.ctrl && input === "e") || key.end) {
        nextCursor = currentValue.length;
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
        const hasPasteMarkers =
          input.includes(BRACKETED_PASTE_START) ||
          input.includes(BRACKETED_PASTE_END) ||
          bracketedPasteBufferRef.current !== null;

        if (hasPasteMarkers) {
          let remaining = input;
          let workingValue = currentValue;
          let workingCursor = currentCursor;

          while (remaining.length > 0) {
            if (bracketedPasteBufferRef.current === null) {
              const startIndex = remaining.indexOf(BRACKETED_PASTE_START);
              if (startIndex === -1) {
                const inserted = insertCleanText(remaining, workingValue, workingCursor);
                workingValue = inserted.nextValue;
                workingCursor = inserted.nextCursor;
                remaining = "";
                break;
              }

              const prefix = remaining.slice(0, startIndex);
              if (prefix) {
                const inserted = insertCleanText(prefix, workingValue, workingCursor);
                workingValue = inserted.nextValue;
                workingCursor = inserted.nextCursor;
              }

              bracketedPasteBufferRef.current = "";
              remaining = remaining.slice(startIndex + BRACKETED_PASTE_START.length);
              continue;
            }

            const endIndex = remaining.indexOf(BRACKETED_PASTE_END);
            if (endIndex === -1) {
              bracketedPasteBufferRef.current += remaining;
              remaining = "";
              break;
            }

            bracketedPasteBufferRef.current += remaining.slice(0, endIndex);
            const inserted = insertCleanText(
              bracketedPasteBufferRef.current,
              workingValue,
              workingCursor,
            );
            workingValue = inserted.nextValue;
            workingCursor = inserted.nextCursor;
            bracketedPasteBufferRef.current = null;
            remaining = remaining.slice(endIndex + BRACKETED_PASTE_END.length);
          }

          nextValue = workingValue;
          nextCursor = workingCursor;
        } else {
          const inserted = insertCleanText(input, currentValue, currentCursor);
          nextValue = inserted.nextValue;
          nextCursor = inserted.nextCursor;
        }
      }
      // Ignore other ctrl/meta combos we don't handle

      // Clamp cursor
      nextCursor = Math.max(0, Math.min(nextCursor, nextValue.length));

      if (nextValue === "") {
        pasteMapRef.current.clear();
      }

      cursorOffsetRef.current = nextCursor;
      setCursorOffset(nextCursor);
      if (nextValue !== currentValue) {
        valueRef.current = nextValue;
        onChange(nextValue);
      }
    },
    { isActive: focus }
  );

  if (originalValue.length === 0 && renderedPlaceholder) {
    return (
      <Box ref={containerRef} flexGrow={1}>
        <Text>{renderedPlaceholder}</Text>
      </Box>
    );
  }

  const rendered = buildRendered();
  const lines = rendered.split("\n");

  return (
    <Box ref={containerRef} flexDirection="column" flexGrow={1}>
      {lines.map((line, i) => (
        <Text key={i}>{line || " "}</Text>
      ))}
    </Box>
  );
}
