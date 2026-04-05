const OPENAI_MODEL_MAP: Record<string, string> = {
  "gpt-5.4": "gpt-5.4",
  "gpt-5.4-mini": "gpt-5.4-mini",
  "openai/gpt-5.4": "gpt-5.4",
  "openai/gpt-5.4-mini": "gpt-5.4-mini",
  "google/gemini-3-flash-preview": "gpt-5.4",
  "google/gemini-3.1-pro": "gpt-5.4",
  "google/gemini-3.1-flash-lite-preview": "gpt-5.4-mini",
  "google/gemini-2.5-flash-lite": "gpt-5.4-mini",
  "google/gemini-2.5-flash": "gpt-5.4-mini",
};

/** Models available via OpenAI OAuth (shown in /config model). */
export const AVAILABLE_MODELS = ["gpt-5.4", "gpt-5.4-mini", "o3", "o4-mini"] as const;
export type AvailableModel = (typeof AVAILABLE_MODELS)[number];

export function resolveOpenAIModel(model?: string): string {
  return OPENAI_MODEL_MAP[model ?? "gpt-5.4"] ?? "gpt-5.4";
}
