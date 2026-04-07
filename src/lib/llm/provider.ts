import type { CallLLMOptions, LLMResponse, StreamingLLMOptions, StreamChunk } from "./types";

/**
 * An LLM provider encapsulates how to make completion calls.
 * Multiple credential paths can resolve to a provider implementation.
 */
export interface LLMProvider {
  readonly kind: "openai_auth" | "openai_api_key" | "gemini_auth" | "gemini_api_key";
  callLLM(options: CallLLMOptions): Promise<LLMResponse>;
  callLLMStreaming(options: StreamingLLMOptions): AsyncGenerator<StreamChunk>;
}
