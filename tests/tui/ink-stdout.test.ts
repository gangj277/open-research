import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import { createStableInkStdout } from "@/tui/ink-stdout";

class MockStdout extends EventEmitter {
  columns = 120;
  rows = 42;
  isTTY = true;
  write = vi.fn(() => true);
}

describe("stable Ink stdout", () => {
  test("preserves stable terminal dimensions while preserving the underlying stream API", () => {
    const stdout = new MockStdout() as unknown as NodeJS.WriteStream;
    const wrapped = createStableInkStdout(stdout);

    expect(wrapped.rows).toBe(42);
    expect(wrapped.columns).toBe(120);
    expect(wrapped.isTTY).toBe(true);

    (stdout as unknown as MockStdout).rows = 0;
    (stdout as unknown as MockStdout).columns = 0;

    expect(wrapped.rows).toBe(42);
    expect(wrapped.columns).toBe(120);

    wrapped.write("hello");
    expect((stdout.write as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("hello");
  });

  test("supports opt-in full redraw mode for terminals that need the legacy path", () => {
    const stdout = new MockStdout() as unknown as NodeJS.WriteStream;
    const wrapped = createStableInkStdout(stdout, { forceFullRedraw: true });

    expect(wrapped.rows).toBe(0);
    expect(wrapped.columns).toBe(120);
  });

  test("suppresses resize notifications while the terminal reports invalid dimensions", () => {
    const stdout = new MockStdout() as unknown as NodeJS.WriteStream;
    const wrapped = createStableInkStdout(stdout);
    const onResize = vi.fn();

    wrapped.on("resize", onResize);

    (stdout as unknown as MockStdout).columns = 0;
    (stdout as unknown as MockStdout).rows = 0;
    (stdout as unknown as MockStdout).emit("resize");

    expect(onResize).not.toHaveBeenCalled();

    (stdout as unknown as MockStdout).columns = 120;
    (stdout as unknown as MockStdout).rows = 42;
    (stdout as unknown as MockStdout).emit("resize");

    expect(onResize).toHaveBeenCalledTimes(1);
  });
});
