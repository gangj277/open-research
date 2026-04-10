import { beforeEach, describe, expect, test, vi } from "vitest";
import type { LLMProvider } from "@/lib/llm/provider";
import type { StreamingLLMOptions, StreamChunk } from "@/lib/llm/types";

const { executeToolMock } = vi.hoisted(() => ({
  executeToolMock: vi.fn(),
}));

vi.mock("@/lib/agent/tool-dispatcher", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
}));

vi.mock("@/lib/memory/store", () => ({
  loadAllMemories: vi.fn(async () => []),
  selectRelevantMemories: vi.fn(() => []),
  formatMemoriesForPrompt: vi.fn(() => ""),
}));

vi.mock("@/lib/memory/extractor", () => ({
  extractAndStoreMemories: vi.fn(async () => []),
}));

vi.mock("@/lib/workspace/agents-md", () => ({
  readAgentsMd: vi.fn(async () => ""),
  maybeUpdateAgentsMd: vi.fn(async () => false),
}));

function createProvider(
  implementations: Array<(options: StreamingLLMOptions) => AsyncGenerator<StreamChunk>>
): LLMProvider & { calls: StreamingLLMOptions[] } {
  const calls: StreamingLLMOptions[] = [];
  return {
    kind: "openai_api_key",
    calls,
    async callLLM() {
      throw new Error("not used in test");
    },
    callLLMStreaming(options: StreamingLLMOptions) {
      calls.push(options);
      const impl = implementations.shift();
      if (!impl) {
        throw new Error("unexpected extra provider call");
      }
      return impl(options);
    },
  };
}

async function* toolCallResponse(
  toolCalls: Array<{ id: string; name: string; arguments: string }>
): AsyncGenerator<StreamChunk> {
  yield {
    type: "done",
    content: "",
    toolCalls,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
  };
}

async function* textResponse(text: string): AsyncGenerator<StreamChunk> {
  yield { type: "text_delta", content: text };
  yield {
    type: "done",
    content: text,
    toolCalls: [],
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
  };
}

describe("runAgentTurn parallel tool execution", () => {
  beforeEach(() => {
    executeToolMock.mockReset();
  });

  test("runs consecutive parallel-safe tools concurrently and advertises that behavior in the system prompt", async () => {
    const provider = createProvider([
      () => toolCallResponse([
        { id: "tool-1", name: "read_file", arguments: JSON.stringify({ file_path: "a.ts" }) },
        { id: "tool-2", name: "read_file", arguments: JSON.stringify({ file_path: "b.ts" }) },
      ]),
      () => textResponse("done"),
    ]);

    const started: string[] = [];
    executeToolMock.mockImplementation(async (_name: string, args: { file_path: string }) => {
      started.push(args.file_path);
      await Promise.resolve();
      return {
        result: `${args.file_path}:started=${started.length}`,
      };
    });

    const { runAgentTurn } = await import("@/lib/agent/runtime");
    await runAgentTurn({
      provider,
      message: "Read both files",
      history: [],
      workspace: {
        workspaceFiles: {},
        availableKeys: [],
      },
    });

    const systemPrompt = provider.calls[0]?.messages[0]?.content;
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt).toContain("concurrently in a single response");

    const secondCallMessages = provider.calls[1]?.messages ?? [];
    const toolMessages = secondCallMessages.filter((message) => message.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.content).toContain("a.ts:started=2");
    expect(toolMessages[1]?.content).toContain("b.ts:started=2");
  });

  test("preserves original tool-call order by treating sequential tools as barriers between parallel batches", async () => {
    const provider = createProvider([
      () => toolCallResponse([
        { id: "read-1", name: "read_file", arguments: JSON.stringify({ file_path: "before.ts" }) },
        { id: "cmd-1", name: "run_command", arguments: JSON.stringify({ command: "echo hi" }) },
        { id: "read-2", name: "read_file", arguments: JSON.stringify({ file_path: "after.ts" }) },
      ]),
      () => textResponse("done"),
    ]);

    const events: string[] = [];
    executeToolMock.mockImplementation(async (name: string, args: Record<string, string>) => {
      const label = args.file_path ?? args.command ?? name;
      events.push(`start:${label}`);
      await Promise.resolve();
      events.push(`end:${label}`);
      return { result: label };
    });

    const { runAgentTurn } = await import("@/lib/agent/runtime");
    await runAgentTurn({
      provider,
      message: "Read, then run, then read",
      history: [],
      workspace: {
        workspaceFiles: {},
        availableKeys: [],
      },
    });

    expect(events).toEqual([
      "start:before.ts",
      "end:before.ts",
      "start:echo hi",
      "end:echo hi",
      "start:after.ts",
      "end:after.ts",
    ]);
  });

  test("uses allSettled-style failure isolation for parallel-safe tools", async () => {
    const provider = createProvider([
      () => toolCallResponse([
        { id: "tool-1", name: "read_file", arguments: JSON.stringify({ file_path: "broken.ts" }) },
        { id: "tool-2", name: "read_file", arguments: JSON.stringify({ file_path: "healthy.ts" }) },
      ]),
      () => textResponse("done"),
    ]);

    executeToolMock.mockImplementation(async (_name: string, args: { file_path: string }) => {
      await Promise.resolve();
      if (args.file_path === "broken.ts") {
        throw new Error("disk blew up");
      }
      return { result: "healthy result" };
    });

    const { runAgentTurn } = await import("@/lib/agent/runtime");
    await expect(
      runAgentTurn({
        provider,
        message: "Read both files",
        history: [],
        workspace: {
          workspaceFiles: {},
          availableKeys: [],
        },
      })
    ).resolves.toMatchObject({ text: "done" });

    const secondCallMessages = provider.calls[1]?.messages ?? [];
    const toolMessages = secondCallMessages.filter((message) => message.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.content).toContain("Error");
    expect(toolMessages[0]?.content).toContain("disk blew up");
    expect(toolMessages[1]?.content).toBe("healthy result");
  });
});
