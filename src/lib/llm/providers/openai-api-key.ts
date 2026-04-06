import type { LLMProvider } from "../provider";
import type {
  CallLLMOptions,
  LLMMessage,
  LLMResponse,
  LLMUsage,
  StreamChunk,
  StreamingLLMOptions,
  AccumulatedToolCall,
} from "../types";
import { resolveOpenAIModel } from "../model-map";
import { costTracker } from "../cost-tracker";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// ── Message Transformation ──────────────────────────────────────────────────
// The /v1/responses API uses the same format as the Codex endpoint:
// system → instructions parameter, messages → input array with custom types.

function extractSystemAndInput(messages: LLMMessage[]): {
  instructions: string;
  input: Array<Record<string, unknown>>;
} {
  let instructions = "You are a helpful assistant.";
  const input: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      instructions =
        typeof msg.content === "string" ? msg.content : instructions;
    } else if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id ?? "",
        output:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      });
    } else if (msg.role === "assistant" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      if (msg.content) {
        input.push({ role: "assistant", content: msg.content });
      }
    } else {
      input.push({ role: msg.role, content: msg.content ?? "" });
    }
  }

  return { instructions, input };
}

function convertTools(
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>
): Array<Record<string, unknown>> | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

// ── SSE Parser ──────────────────────────────────────────────────────────────

async function* parseResponsesSSE(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEvent = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7);
        } else if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            yield { type: currentEvent || data.type || "", data };
          } catch {
            // Skip malformed SSE frames
          }
        } else if (trimmed === "") {
          currentEvent = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export function createOpenAIAPIKeyProvider(apiKey: string): LLMProvider {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  async function callLLM(options: CallLLMOptions): Promise<LLMResponse> {
    const model = resolveOpenAIModel(options.model);
    const { instructions, input } = extractSystemAndInput(options.messages);

    const body: Record<string, unknown> = {
      model,
      instructions,
      input,
      store: false,
      stream: true,
    };

    if (options.reasoningEffort && options.reasoningEffort !== "none") {
      body.reasoning = { effort: options.reasoningEffort };
    }

    if (options.jsonSchema) {
      body.text = {
        format: {
          type: "json_schema",
          name: options.jsonSchema.name,
          strict: true,
          schema: options.jsonSchema.schema,
        },
      };
    }

    const start = Date.now();
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.timeoutMs
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenAI API error ${response.status}: ${text.slice(0, 300)}`
      );
    }

    let fullContent = "";
    let usageData: LLMUsage | undefined;
    let responseModel = model;

    for await (const event of parseResponsesSSE(response.body!)) {
      if (event.type === "response.output_text.delta") {
        fullContent += (event.data as { delta?: string }).delta ?? "";
      } else if (event.type === "response.completed") {
        const resp = event.data.response as
          | Record<string, unknown>
          | undefined;
        if (resp?.usage) {
          const u = resp.usage as Record<string, unknown>;
          const inputDetails = u.input_tokens_details as
            | Record<string, number>
            | undefined;
          const outputDetails = u.output_tokens_details as
            | Record<string, number>
            | undefined;
          const inputTokens = (u.input_tokens as number) ?? 0;
          const outputTokens = (u.output_tokens as number) ?? 0;
          usageData = {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens:
              (u.total_tokens as number) ?? inputTokens + outputTokens,
            cachedTokens: inputDetails?.cached_tokens ?? 0,
            reasoningTokens: outputDetails?.reasoning_tokens ?? 0,
          };
        }
        if (resp?.model) responseModel = resp.model as string;
      }
    }

    const latencyMs = Date.now() - start;
    if (usageData) {
      costTracker.record(
        responseModel,
        usageData.promptTokens,
        usageData.completionTokens
      );
    }

    return {
      content: fullContent,
      model: responseModel,
      usage: usageData ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      latencyMs,
    };
  }

  async function* callLLMStreaming(
    options: StreamingLLMOptions
  ): AsyncGenerator<StreamChunk> {
    const model = resolveOpenAIModel(options.model);
    const { instructions, input } = extractSystemAndInput(options.messages);

    const body: Record<string, unknown> = {
      model,
      instructions,
      input,
      store: false,
      stream: true,
    };

    if (options.reasoningEffort && options.reasoningEffort !== "none") {
      body.reasoning = { effort: options.reasoningEffort };
    }

    const tools = convertTools(options.tools);
    if (tools) {
      body.tools = tools;
    }

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenAI API error ${response.status}: ${text.slice(0, 300)}`
      );
    }

    if (!response.body) {
      throw new Error("OpenAI API returned no response body.");
    }

    let fullContent = "";
    const toolCallsByItemId = new Map<
      string,
      { index: number; tc: AccumulatedToolCall }
    >();
    let toolCallIndex = 0;
    let usage: LLMUsage | undefined;

    for await (const event of parseResponsesSSE(response.body)) {
      switch (event.type) {
        case "response.output_text.delta": {
          const delta = (event.data as { delta?: string }).delta ?? "";
          fullContent += delta;
          yield { type: "text_delta", content: delta };
          break;
        }

        case "response.output_item.added": {
          const item = (event.data as { item?: Record<string, unknown> }).item;
          if (item?.type === "function_call") {
            const itemId = (item.id as string) ?? "";
            const callId =
              (item.call_id as string) ?? `call_${toolCallIndex}`;
            const name = (item.name as string) ?? "";
            const index = toolCallIndex++;
            toolCallsByItemId.set(itemId, {
              index,
              tc: { id: callId, name, arguments: "" },
            });
            if (name) {
              yield { type: "tool_call_start", index, id: callId, name };
            }
          }
          break;
        }

        case "response.function_call_arguments.delta": {
          const itemId =
            (event.data as { item_id?: string }).item_id ?? "";
          const argDelta = (event.data as { delta?: string }).delta ?? "";
          const entry = toolCallsByItemId.get(itemId);
          if (entry) {
            entry.tc.arguments += argDelta;
            yield {
              type: "tool_call_delta",
              index: entry.index,
              arguments: argDelta,
            };
          }
          break;
        }

        case "response.function_call_arguments.done": {
          const itemId =
            (event.data as { item_id?: string }).item_id ?? "";
          const fullArgs =
            (event.data as { arguments?: string }).arguments ?? "";
          const entry = toolCallsByItemId.get(itemId);
          if (entry) {
            entry.tc.arguments = fullArgs;
          }
          break;
        }

        case "response.completed": {
          const resp = event.data.response as
            | Record<string, unknown>
            | undefined;
          if (resp?.usage) {
            const u = resp.usage as Record<string, unknown>;
            const inputDetails = u.input_tokens_details as
              | Record<string, number>
              | undefined;
            const outputDetails = u.output_tokens_details as
              | Record<string, number>
              | undefined;
            const inputTokens = (u.input_tokens as number) ?? 0;
            const outputTokens = (u.output_tokens as number) ?? 0;
            usage = {
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              totalTokens:
                (u.total_tokens as number) ?? inputTokens + outputTokens,
              cachedTokens: inputDetails?.cached_tokens ?? 0,
              reasoningTokens: outputDetails?.reasoning_tokens ?? 0,
            };
          }
          break;
        }
      }
    }

    if (usage) {
      costTracker.record(
        model,
        usage.promptTokens,
        usage.completionTokens
      );
    }

    yield {
      type: "done",
      content: fullContent,
      toolCalls: [...toolCallsByItemId.values()].map((e) => e.tc),
      usage,
    };
  }

  return {
    kind: "openai_api_key",
    callLLM,
    callLLMStreaming,
  };
}
