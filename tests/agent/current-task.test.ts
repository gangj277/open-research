import { describe, it, expect, beforeEach } from "vitest";
import {
  executeSetCurrentTask,
  getCurrentTaskBlock,
  clearCurrentTask,
} from "@/lib/agent/tools/current-task";

describe("current-task", () => {
  beforeEach(() => {
    clearCurrentTask();
  });

  it("returns null when no task is set", () => {
    expect(getCurrentTaskBlock()).toBeNull();
  });

  it("sets current task and returns context block", () => {
    const result = executeSetCurrentTask({ task: "Searching for scaling law papers" });
    expect(result).toContain("Searching for scaling law papers");
    expect(getCurrentTaskBlock()).toBe("## Current Focus\nSearching for scaling law papers");
  });

  it("overwrites previous task", () => {
    executeSetCurrentTask({ task: "First task" });
    executeSetCurrentTask({ task: "Second task" });
    expect(getCurrentTaskBlock()).toBe("## Current Focus\nSecond task");
  });

  it("clears task", () => {
    executeSetCurrentTask({ task: "Some task" });
    clearCurrentTask();
    expect(getCurrentTaskBlock()).toBeNull();
  });
});
