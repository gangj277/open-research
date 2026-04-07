import { afterEach, describe, expect, test, vi } from "vitest";
import { createSentenceStreamBuffer, splitMessagesForRender, STREAM_FLUSH_INTERVAL_MS } from "@/tui/streaming";

describe("streaming helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("holds text until a sentence boundary arrives", () => {
    const flushed: string[] = [];
    const buffer = createSentenceStreamBuffer({
      onFlush: (text) => {
        flushed.push(text);
      },
    });

    buffer.push("Hello");
    expect(flushed).toEqual([]);

    buffer.push(" world. ");
    expect(flushed).toEqual(["Hello world. "]);
  });

  test("falls back to the timer and allows an explicit pre-tool flush", async () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const buffer = createSentenceStreamBuffer({
      flushIntervalMs: STREAM_FLUSH_INTERVAL_MS,
      onFlush: (text) => {
        flushed.push(text);
      },
    });

    buffer.push("Working");
    await vi.advanceTimersByTimeAsync(STREAM_FLUSH_INTERVAL_MS - 1);
    expect(flushed).toEqual([]);

    buffer.flush();
    expect(flushed).toEqual(["Working"]);

    buffer.push("tail");
    await vi.advanceTimersByTimeAsync(STREAM_FLUSH_INTERVAL_MS);
    expect(flushed).toEqual(["Working", "tail"]);
  });

  test("keeps only the live assistant message dynamic while busy", () => {
    const messages = [
      { role: "user" as const, text: "Question" },
      { role: "assistant" as const, text: "Finished answer" },
      { role: "user" as const, text: "Follow-up" },
      { role: "assistant" as const, text: "Streaming now" },
    ];

    expect(splitMessagesForRender(messages, true)).toEqual({
      staticMessages: messages.slice(0, -1),
      dynamicMessages: [messages[3]],
    });

    expect(splitMessagesForRender(messages, false)).toEqual({
      staticMessages: messages,
      dynamicMessages: [],
    });
  });

  test("keeps the latest tool summary dynamic after streaming settles", () => {
    const messages = [
      { role: "user" as const, text: "Question" },
      { role: "assistant" as const, text: "Finished answer" },
      {
        role: "system" as const,
        text: '__tool_summary__{"summary":"Read 2 files","tools":[]}',
      },
    ];

    expect(splitMessagesForRender(messages, false)).toEqual({
      staticMessages: messages.slice(0, -1),
      dynamicMessages: [messages[2]],
    });
  });
});
