import { describe, expect, test } from "vitest";
import { DEFAULT_TERMINAL_WIDTH, MIN_TERMINAL_WIDTH, getObservedTerminalWidth, getStableObservedTerminalWidth } from "@/tui/layout";

describe("terminal width helpers", () => {
  test("falls back to the default width when no valid widths are observed", () => {
    expect(getObservedTerminalWidth(undefined, 0, -1)).toBe(DEFAULT_TERMINAL_WIDTH);
  });

  test("preserves the current width when resize events report no usable columns", () => {
    expect(getStableObservedTerminalWidth(96, undefined, 0)).toBe(96);
  });

  test("normalizes to the smallest positive observed width with the minimum floor", () => {
    expect(getStableObservedTerminalWidth(96, 140, 72)).toBe(72);
    expect(getStableObservedTerminalWidth(96, 8)).toBe(MIN_TERMINAL_WIDTH);
  });
});
