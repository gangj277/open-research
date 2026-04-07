import type { LLMProvider } from "../provider";
import type { CallLLMOptions, LLMResponse, StreamingLLMOptions, StreamChunk, AccumulatedToolCall, LLMUsage } from "../types";
import { convertMessagesToGemini, convertToolsToGemini, mapReasoningEffort, mapJsonSchema } from "../gemini-format";

// ── Constants ──────────────────────────────────────────────────────────────

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ── Provider ───────────────────────────────────────────────────────────────

export function createGeminiAPIKeyProvider(apiKey: string): LLMProvider {

  function buildRequestBody(options: StreamingLLMOptions | CallLLMOptions, model: string): Record<string, unknown> {
    const { systemInstruction, contents } = convertMessagesToGemini(options.messages);

    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;

    const thinking = mapReasoningEffort(options.reasoningEffort, model);
    if (thinking) Object.assign(generationConfig, thinking);

    if ("jsonSchema" in options && options.jsonSchema) {
      const schema = mapJsonSchema(options.jsonSchema);
      if (schema) Object.assign(generationConfig, schema);
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemInstruction) body.systemInstruction = systemInstruction;

    if ("tools" in options && options.tools) {
      const geminiTools = convertToolsToGemini(options.tools);
      if (geminiTools) body.tools = [geminiTools];
    }

    return body;
  }

  // ── callLLM ────────────────────────────────────────────────────────────

  async function callLLM(options: CallLLMOptions): Promise<LLMResponse> {
    const model = options.model ?? "gemini-3-flash-preview";
    const body = buildRequestBody(options, model);
    const startTime = Date.now();

    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: Record<string, number>;
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p.text ?? "").join("");
    const usage = data.usageMetadata ?? {};

    return {
      content,
      model,
      usage: {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  // ── callLLMStreaming ───────────────────────────────────────────────────

  async function* callLLMStreaming(options: StreamingLLMOptions): AsyncGenerator<StreamChunk> {
    const model = options.model ?? "gemini-3-flash-preview";
    const body = buildRequestBody(options, model);

    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: options.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini streaming error: ${response.status} ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    const toolCalls: AccumulatedToolCall[] = [];
    let toolCallIndex = 0;
    let lastUsage: LLMUsage | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n")) {
        const lineEnd = buffer.indexOf("\n");
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6);
        if (jsonStr === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        // AI Studio: no envelope wrapping (unlike Code Assist)
        const candidates = (parsed.candidates as Array<Record<string, unknown>>) ?? [];
        const candidate = candidates[0];
        if (!candidate) continue;

        const parts = ((candidate.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>) ?? [];

        for (const part of parts) {
          if (typeof part.text === "string" && part.text) {
            if (part.thought === true) continue;
            fullText += part.text;
            yield { type: "text_delta", content: part.text };
          }

          if (part.functionCall) {
            const fc = part.functionCall as { name: string; args: Record<string, unknown> };
            const id = `call_${crypto.randomUUID().slice(0, 8)}`;
            const args = JSON.stringify(fc.args ?? {});
            toolCalls.push({ id, name: fc.name, arguments: args });
            yield { type: "tool_call_start", index: toolCallIndex, id, name: fc.name };
            yield { type: "tool_call_delta", index: toolCallIndex, arguments: args };
            toolCallIndex++;
          }
        }

        const usage = parsed.usageMetadata as Record<string, number> | undefined;
        if (usage) {
          lastUsage = {
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
            cachedTokens: usage.cachedContentTokenCount ?? 0,
            reasoningTokens: usage.thoughtsTokenCount ?? 0,
          };
        }
      }
    }

    yield {
      type: "done",
      content: fullText,
      toolCalls,
      usage: lastUsage,
    };
  }

  return {
    kind: "gemini_api_key",
    callLLM,
    callLLMStreaming,
  };
}
