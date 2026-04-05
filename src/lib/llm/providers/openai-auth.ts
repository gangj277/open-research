import { costTracker } from "../cost-tracker";
import { resolveOpenAIModel } from "../model-map";
import { refreshAccessToken } from "@/lib/auth/openai-oauth";
import { CODEX_RESPONSES_URL } from "../config";
import type { LLMProvider } from "../provider";
import type {
  CallLLMOptions,
  LLMResponse,
  LLMMessage,
  StreamingLLMOptions,
  StreamChunk,
  AccumulatedToolCall,
} from "../types";
import type { CredentialValidation } from "@/lib/storage/credential-types";

export interface OpenAIAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
}

type OnTokenRefresh = (newCreds: OpenAIAuthCredentials) => Promise<void>;
type OnValidationChange = (validation: CredentialValidation) => Promise<void>;

function extractSystemAndInput(messages: LLMMessage[]): {
  instructions: string;
  input: Array<Record<string, unknown>>;
} {
  let instructions = "You are a helpful assistant.";
  const input: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      instructions = typeof msg.content === "string" ? msg.content : instructions;
    } else if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id ?? "",
        output:
          typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
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

function convertToolsForResponsesAPI(
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
            // Skip malformed SSE frames.
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toValidation(
  status: CredentialValidation["status"],
  code: number | null,
  message: string
): CredentialValidation {
  return {
    status,
    validatedAt: new Date().toISOString(),
    capabilities: {
      basic: status !== "invalid",
      json: status !== "invalid",
      streaming: status !== "invalid",
      toolCalling: status !== "invalid",
      liteModel: status === "valid",
    },
    lastErrorCode: code,
    lastErrorMessage: message,
  };
}

export function createOpenAIAuthProvider(
  credentials: OpenAIAuthCredentials,
  onTokenRefresh: OnTokenRefresh,
  onValidationChange?: OnValidationChange
): LLMProvider {
  let creds = { ...credentials };

  async function reportValidation(
    status: CredentialValidation["status"],
    code: number | null,
    message: string
  ) {
    if (!onValidationChange) return;
    await onValidationChange(toValidation(status, code, message));
  }

  async function ensureValidToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (forceRefresh || creds.expiresAt - now < 30_000) {
      try {
        const response = await refreshAccessToken(creds.refreshToken);
        creds = {
          accessToken: response.access_token,
          refreshToken: response.refresh_token || creds.refreshToken,
          expiresAt: Date.now() + response.expires_in * 1000,
          accountId: creds.accountId,
        };
        await onTokenRefresh(creds);
        return creds.accessToken;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Token refresh failed";
        await reportValidation("invalid", 401, message);
        throw new Error(
          "OpenAI token refresh failed. Reconnect your OpenAI account and retry."
        );
      }
    }

    return creds.accessToken;
  }

  const sessionId = crypto.randomUUID();

  function buildHeaders(token: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      originator: "open-research",
      "User-Agent": `open-research/${process.env.npm_package_version ?? "0.1.0"} (${process.platform} ${process.arch})`,
      session_id: sessionId,
    };

    if (creds.accountId) {
      headers["ChatGPT-Account-Id"] = creds.accountId;
    }

    return headers;
  }

  async function performRequest(
    body: Record<string, unknown>
  ): Promise<Response> {
    let token = await ensureValidToken();
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: buildHeaders(token),
        body: JSON.stringify(body),
      });

      lastResponse = response;

      if (response.status === 401 && attempt === 0) {
        token = await ensureValidToken(true);
        continue;
      }

      if (response.status === 403) {
        const errorBody = await response.text();
        await reportValidation("invalid", 403, errorBody || "Permission error");
        return new Response(errorBody, {
          status: 403,
          headers: response.headers,
        });
      }

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < 2
      ) {
        await reportValidation("degraded", response.status, "Transient provider error");
        await sleep(250 * 2 ** attempt);
        continue;
      }

      return response;
    }

    return (
      lastResponse ??
      new Response("OpenAI request failed", {
        status: 500,
      })
    );
  }

  return {
    kind: "openai_auth",

    async callLLM(options: CallLLMOptions): Promise<LLMResponse> {
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
      const response = await performRequest(body);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI auth ${response.status}: ${errorBody}`);
      }

      let fullContent = "";
      let usageData:
        | import("../types").LLMUsage
        | undefined;
      let responseModel = model;

      for await (const event of parseResponsesSSE(response.body!)) {
        if (event.type === "response.output_text.delta") {
          fullContent += (event.data as { delta?: string }).delta ?? "";
        } else if (event.type === "response.completed") {
          const resp = event.data.response as Record<string, unknown> | undefined;
          if (resp?.usage) {
            const u = resp.usage as Record<string, unknown>;
            const inputDetails = u.input_tokens_details as Record<string, number> | undefined;
            const outputDetails = u.output_tokens_details as Record<string, number> | undefined;
            const inputTokens = (u.input_tokens as number) ?? 0;
            const outputTokens = (u.output_tokens as number) ?? 0;
            usageData = {
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              totalTokens: (u.total_tokens as number) ?? inputTokens + outputTokens,
              cachedTokens: inputDetails?.cached_tokens ?? 0,
              reasoningTokens: outputDetails?.reasoning_tokens ?? 0,
            };
          }
          if (resp?.model) {
            responseModel = resp.model as string;
          }
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
        usage:
          usageData ?? {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
        latencyMs,
      };
    },

    async *callLLMStreaming(
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

      const tools = convertToolsForResponsesAPI(options.tools);
      if (tools) {
        body.tools = tools;
      }

      const response = await performRequest(body);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI auth streaming ${response.status}: ${errorBody}`);
      }

      if (!response.body) {
        throw new Error("No response body from OpenAI auth streaming");
      }

      let fullContent = "";
      const toolCallsByItemId = new Map<
        string,
        { index: number; tc: AccumulatedToolCall }
      >();
      let toolCallIndex = 0;
      let usage:
        | import("../types").LLMUsage
        | undefined;

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
              const callId = (item.call_id as string) ?? `call_${toolCallIndex}`;
              const name = (item.name as string) ?? "";
              const index = toolCallIndex++;
              toolCallsByItemId.set(itemId, {
                index,
                tc: { id: callId, name, arguments: "" },
              });
              if (name) {
                yield {
                  type: "tool_call_start",
                  index,
                  id: callId,
                  name,
                };
              }
            }
            break;
          }

          case "response.function_call_arguments.delta": {
            const itemId = (event.data as { item_id?: string }).item_id ?? "";
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
            const itemId = (event.data as { item_id?: string }).item_id ?? "";
            const fullArgs =
              (event.data as { arguments?: string }).arguments ?? "";
            const entry = toolCallsByItemId.get(itemId);
            if (entry) {
              entry.tc.arguments = fullArgs;
            }
            break;
          }

          case "response.completed": {
            const resp = event.data.response as Record<string, unknown> | undefined;
            if (resp?.usage) {
              const u = resp.usage as Record<string, unknown>;
              const inputDetails = u.input_tokens_details as Record<string, number> | undefined;
              const outputDetails = u.output_tokens_details as Record<string, number> | undefined;
              const inputTokens = (u.input_tokens as number) ?? 0;
              const outputTokens = (u.output_tokens as number) ?? 0;
              usage = {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: (u.total_tokens as number) ?? inputTokens + outputTokens,
                cachedTokens: inputDetails?.cached_tokens ?? 0,
                reasoningTokens: outputDetails?.reasoning_tokens ?? 0,
              };
            }
            break;
          }
        }
      }

      if (usage) {
        costTracker.record(model, usage.promptTokens, usage.completionTokens);
      }

      const toolCalls = [...toolCallsByItemId.values()]
        .sort((left, right) => left.index - right.index)
        .map(({ tc }) => tc);

      yield {
        type: "done",
        content: fullContent,
        toolCalls,
        usage,
      };
    },
  };
}
