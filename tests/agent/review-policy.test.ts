import { describe, expect, test } from "vitest";
import { classifyUpdateRisk } from "@/lib/agent/review-policy";
import type { ProposedUpdate } from "@/lib/agent/state";

function createUpdate(update: Partial<ProposedUpdate>): ProposedUpdate {
  return {
    id: "u1",
    type: "new",
    key: "note:new-file",
    content: "hello",
    summary: "summary",
    ...update,
  };
}

describe("review policy", () => {
  test("auto-applies safe new files inside managed folders", () => {
    const result = classifyUpdateRisk(
      createUpdate({
        key: "path:notes/new-note.md",
      })
    );

    expect(result.policy).toBe("auto-apply");
  });

  test("requires review for edits to existing files", () => {
    const result = classifyUpdateRisk(
      createUpdate({
        type: "edit",
        key: "path:artifacts/overview.md",
      })
    );

    expect(result.policy).toBe("review-required");
  });
});
