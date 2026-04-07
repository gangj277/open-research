import type { LLMProvider } from "../provider";
import type { CallLLMOptions, LLMResponse, StreamingLLMOptions, StreamChunk, AccumulatedToolCall, LLMUsage } from "../types";
import { convertMessagesToGemini, convertToolsToGemini, mapReasoningEffort, mapJsonSchema } from "../gemini-format";
import { refreshGeminiAccessToken, GEMINI_CODE_ASSIST_URL } from "@/lib/auth/gemini-oauth";
import { getPackageVersion } from "@/lib/cli/version";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GeminiAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  projectId: string;
}

type OnTokenRefresh = (newCreds: GeminiAuthCredentials) => Promise<void>;

// ── State ──────────────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 60_000;
const GEMINI_CLI_VERSION = "0.30.0";
const sessionId = crypto.randomUUID();

// ── Provider ───────────────────────────────────────────────────────────────

export function createGeminiAuthProvider(
  credentials: GeminiAuthCredentials,
  onTokenRefresh: OnTokenRefresh,
): LLMProvider {
  let currentToken = credentials.accessToken;
  let currentExpiry = credentials.expiresAt;
  let refreshing: Promise<void> | null = null;

  async function ensureValidToken(): Promise<string> {
    if (Date.now() < currentExpiry - REFRESH_BUFFER_MS) {
      return currentToken;
    }

    if (!refreshing) {
      refreshing = (async () => {
        const result = await refreshGeminiAccessToken(credentials.refreshToken);
        currentToken = result.access_token;
        currentExpiry = Date.now() + result.expires_in * 1000;
        if (result.refresh_token) {
          credentials.refreshToken = result.refresh_token;
        }
        await onTokenRefresh({
          ...credentials,
          accessToken: currentToken,
          expiresAt: currentExpiry,
        });
      })();
    }

    try {
      await refreshing;
    } finally {
      refreshing = null;
    }
    return currentToken;
  }

  function buildHeaders(token: string, model: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `GeminiCLI/${GEMINI_CLI_VERSION}/${model} (${process.platform}; ${process.arch})`,
      "x-activity-request-id": Math.random().toString(36).slice(2, 10),
    };
  }

  function buildRequestBody(options: StreamingLLMOptions | CallLLMOptions, model: string): Record<string, unknown> {
    const messages = options.messages;
    const { systemInstruction, contents } = convertMessagesToGemini(messages);

    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;

    // Reasoning effort
    const thinking = mapReasoningEffort(options.reasoningEffort, model);
    if (thinking) Object.assign(generationConfig, thinking);

    // JSON schema (for callLLM)
    if ("jsonSchema" in options && options.jsonSchema) {
      const schema = mapJsonSchema(options.jsonSchema);
      if (schema) Object.assign(generationConfig, schema);
    }

    const request: Record<string, unknown> = {
      contents,
      generationConfig,
      session_id: sessionId,
    };

    if (systemInstruction) request.systemInstruction = systemInstruction;

    // Tools
    if ("tools" in options && options.tools) {
      const geminiTools = convertToolsToGemini(options.tools);
      if (geminiTools) request.tools = [geminiTools];
    }

    return {
      project: credentials.projectId,
      model,
      user_prompt_id: crypto.randomUUID(),
      request,
    };
  }

  // ── callLLM ────────────────────────────────────────────────────────────

  async function callLLM(options: CallLLMOptions): Promise<LLMResponse> {
    const model = options.model ?? "gemini-3.1-pro-preview";
    const token = await ensureValidToken();
    const body = buildRequestBody(options, model);
    const startTime = Date.now();

    const response = await fetch(
      `${GEMINI_CODE_ASSIST_URL}/v1internal:generateContent`,
      {
        method: "POST",
        headers: buildHeaders(token, model),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      response?: {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: Record<string, number>;
      };
    };

    const inner = data.response ?? data;
    const parts = (inner as any).candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p: { text?: string }) => p.text ?? "").join("");
    const usage = (inner as any).usageMetadata ?? {};

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
    const model = options.model ?? "gemini-3.1-pro-preview";
    const token = await ensureValidToken();
    const body = buildRequestBody(options, model);

    const response = await fetch(
      `${GEMINI_CODE_ASSIST_URL}/v1internal:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          ...buildHeaders(token, model),
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: options.signal,
      }
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

      // Process complete SSE lines
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

        // Unwrap Code Assist envelope
        const inner = (parsed.response ?? parsed) as Record<string, unknown>;
        const candidates = (inner.candidates as Array<Record<string, unknown>>) ?? [];
        const candidate = candidates[0];
        if (!candidate) continue;

        const parts = ((candidate.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>) ?? [];

        for (const part of parts) {
          // Text part
          if (typeof part.text === "string" && part.text) {
            // Skip thought parts
            if (part.thought === true) continue;
            fullText += part.text;
            yield { type: "text_delta", content: part.text };
          }

          // Function call part
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

        // Extract usage metadata
        const usage = inner.usageMetadata as Record<string, number> | undefined;
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
    kind: "gemini_auth",
    callLLM,
    callLLMStreaming,
  };
}
