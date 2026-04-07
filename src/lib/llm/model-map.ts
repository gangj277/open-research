const OPENAI_MODEL_MAP: Record<string, string> = {
  "gpt-5.4": "gpt-5.4",
  "gpt-5.4-mini": "gpt-5.4-mini",
  "openai/gpt-5.4": "gpt-5.4",
  "openai/gpt-5.4-mini": "gpt-5.4-mini",
};

export function resolveOpenAIModel(model?: string): string {
  return OPENAI_MODEL_MAP[model ?? "gpt-5.4"] ?? "gpt-5.4";
}
