import type { CallLLMOptions, LLMResponse, StreamingLLMOptions, StreamChunk } from "./types";

/**
 * An LLM provider encapsulates how to make completion calls.
 * The app now supports a single provider implementation: OpenAI auth.
 */
export interface LLMProvider {
  readonly kind: "openai_auth";
  callLLM(options: CallLLMOptions): Promise<LLMResponse>;
  callLLMStreaming(options: StreamingLLMOptions): AsyncGenerator<StreamChunk>;
}
