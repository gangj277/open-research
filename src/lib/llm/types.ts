import type { ToolDefinition } from "@/lib/agent/tools";

// ─── Message Types ───────────────────────────────────────────────────────────

export interface LLMToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "input_text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
  | {
      type: "input_file";
      file_data?: string;
      file_id?: string;
      file_url?: string;
      filename?: string;
    };

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Content text or multimodal content parts — null on assistant messages that only contain tool_calls (per OpenAI spec) */
  content: string | ContentPart[] | null;
  /** Present on assistant messages that invoke tools */
  tool_calls?: LLMToolCall[];
  /** Present on tool-result messages — must match the tool_call id */
  tool_call_id?: string;
}

// ─── Call Options ────────────────────────────────────────────────────────────

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface CallLLMOptions {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  reasoningEffort?: ReasoningEffort;
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

// ─── Streaming Types ─────────────────────────────────────────────────────────

export interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type StreamChunk =
  | { type: "text_delta"; content: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_delta"; index: number; arguments: string }
  | {
      type: "done";
      content: string;
      toolCalls: AccumulatedToolCall[];
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

export interface StreamingLLMOptions {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
}
