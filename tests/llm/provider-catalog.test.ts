import { describe, expect, test } from "vitest";
import {
  getAvailableModels,
  selectModelForTask,
} from "@/lib/llm/provider-catalog";

describe("provider catalog", () => {
  test("returns the OpenAI model list for current providers", () => {
    expect(getAvailableModels("openai_auth")).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "o3",
      "o4-mini",
    ]);
  });

  test("uses the lightweight model for 5.4 compaction and background tasks", () => {
    expect(selectModelForTask("openai_auth", "gpt-5.4", "compaction")).toBe("gpt-5.4-mini");
    expect(selectModelForTask("openai_auth", "o3", "compaction")).toBe("o3");
    expect(selectModelForTask("openai_auth", "o3", "memory")).toBe("gpt-5.4-mini");
    expect(selectModelForTask("openai_api_key", undefined, "workspace")).toBe("gpt-5.4-mini");
  });
});
