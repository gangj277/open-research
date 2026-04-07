import path from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("cli render options", () => {
  test("disables Ink's built-in Ctrl+C exit", async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, "../../src/cli.ts"),
      "utf8"
    );

    expect(source).toMatch(/exitOnCtrlC:\s*false/);
  });

  test("wraps stdout to force stable full redraws in the live Ink app", async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, "../../src/cli.ts"),
      "utf8"
    );

    expect(source).toMatch(/createStableInkStdout\(process\.stdout\)/);
  });
});
