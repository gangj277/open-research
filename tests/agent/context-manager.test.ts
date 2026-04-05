import { describe, expect, test } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  getContextWindow,
  getCompactThreshold,
  pruneToolOutputs,
  createSessionUsage,
  updateUsageFromApi,
} from "@/lib/agent/context-manager";
import type { LLMMessage } from "@/lib/llm/types";

describe("token estimation", () => {
  test("estimates ~4 bytes per token", () => {
    const tokens = estimateTokens("hello world"); // 11 bytes
    expect(tokens).toBe(3); // ceil(11/4)
  });

  test("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("handles unicode", () => {
    const tokens = estimateTokens("안녕하세요"); // 15 bytes in UTF-8
    expect(tokens).toBe(4); // ceil(15/4)
  });
});

describe("message token estimation", () => {
  test("estimates tokens for a text message", () => {
    const msg: LLMMessage = { role: "user", content: "What is the meaning of life?" };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(4); // overhead + content
  });

  test("estimates tokens for a tool call message", () => {
    const msg: LLMMessage = {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "read_file", arguments: '{"file_path":"test.txt"}' },
      }],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(4);
  });
});

describe("context windows", () => {
  test("returns correct window for gpt-5.4", () => {
    expect(getContextWindow("gpt-5.4")).toBe(272_000);
  });

  test("returns correct window for gpt-4o", () => {
    expect(getContextWindow("gpt-4o")).toBe(128_000);
  });

  test("returns default for unknown model", () => {
    expect(getContextWindow("unknown-model")).toBe(128_000);
  });

  test("compact threshold is 90% of context window", () => {
    expect(getCompactThreshold("gpt-5.4")).toBe(Math.floor(272_000 * 0.9));
  });
});

describe("pruneToolOutputs", () => {
  test("prunes old tool outputs while preserving recent ones", () => {
    // Create messages with tool outputs of known sizes
    // Each ~50K tokens → 4 of them = ~200K, well over PRUNE_PROTECT (40K)
    const bigContent = "x".repeat(200_000);
    const messages: LLMMessage[] = [
      { role: "system", content: "You are a helper." },
      { role: "user", content: "Do something." },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "1", content: bigContent },
      { role: "assistant", content: null, tool_calls: [{ id: "2", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "2", content: bigContent },
      { role: "assistant", content: null, tool_calls: [{ id: "3", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "3", content: bigContent },
      { role: "assistant", content: null, tool_calls: [{ id: "4", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "4", content: bigContent },
    ];

    const { messages: pruned, savedTokens } = pruneToolOutputs(messages);

    // The most recent tool outputs should be preserved
    const toolMsgs = pruned.filter((m) => m.role === "tool");
    const preserved = toolMsgs.filter((m) => typeof m.content === "string" && !m.content.includes("pruned"));
    const prunedMsgs = toolMsgs.filter((m) => typeof m.content === "string" && m.content.includes("pruned"));

    expect(preserved.length).toBeGreaterThan(0);
    expect(savedTokens).toBeGreaterThan(0);
  });

  test("does not prune when savings are too small", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "You are a helper." },
      { role: "user", content: "Hi" },
      { role: "tool", tool_call_id: "1", content: "small output" },
    ];

    const { messages: pruned, savedTokens } = pruneToolOutputs(messages);
    expect(savedTokens).toBe(0);
    expect(pruned).toBe(messages); // Same reference — no change
  });
});

describe("session usage tracking", () => {
  test("creates empty usage", () => {
    const usage = createSessionUsage();
    expect(usage.totalTokens).toBe(0);
    expect(usage.compactionCount).toBe(0);
  });

  test("updates from API response", () => {
    const usage = createSessionUsage();
    updateUsageFromApi(usage, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
    expect(usage.lastTurnTokens).toBe(150);

    // Second update accumulates
    updateUsageFromApi(usage, { promptTokens: 200, completionTokens: 80, totalTokens: 280 });
    expect(usage.inputTokens).toBe(300);
    expect(usage.outputTokens).toBe(130);
    expect(usage.totalTokens).toBe(430);
    expect(usage.lastTurnTokens).toBe(280);
  });
});
