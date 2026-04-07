export type ProviderTask =
  | "conversation"
  | "compaction"
  | "memory"
  | "workspace";

export const OPENAI_PROVIDER_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "o3",
  "o4-mini",
] as const;

export interface ProviderCatalog {
  family: string;
  displayName: string;
  models: readonly string[];
  defaultModel: string;
  backgroundModel: string;
}

const OPENAI_CATALOG: ProviderCatalog = {
  family: "openai",
  displayName: "OpenAI",
  models: OPENAI_PROVIDER_MODELS,
  defaultModel: "gpt-5.4",
  backgroundModel: "gpt-5.4-mini",
};

export const GEMINI_PROVIDER_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
] as const;

const GEMINI_CATALOG: ProviderCatalog = {
  family: "gemini",
  displayName: "Gemini",
  models: GEMINI_PROVIDER_MODELS,
  defaultModel: "gemini-3.1-pro-preview",
  backgroundModel: "gemini-3-flash-preview",
};

export function getProviderCatalog(providerKind?: string): ProviderCatalog {
  switch (providerKind) {
    case "gemini_auth":
    case "gemini_api_key":
      return GEMINI_CATALOG;
    case "openai_auth":
    case "openai_api_key":
    default:
      return OPENAI_CATALOG;
  }
}

export function getAvailableModels(providerKind?: string): readonly string[] {
  return getProviderCatalog(providerKind).models;
}

function isSupportedModel(model: string | undefined, providerKind?: string): boolean {
  if (!model) return false;
  return getAvailableModels(providerKind).includes(model);
}

export function getDefaultModel(providerKind?: string): string {
  return getProviderCatalog(providerKind).defaultModel;
}

export function selectModelForTask(
  providerKind: string | undefined,
  requestedModel: string | undefined,
  task: ProviderTask
): string {
  const catalog = getProviderCatalog(providerKind);
  const selected = isSupportedModel(requestedModel, providerKind)
    ? requestedModel!
    : catalog.defaultModel;

  switch (task) {
    case "conversation":
      return selected;
    case "compaction":
      return (selected.includes("5.4") || selected.includes("pro")) ? catalog.backgroundModel : selected;
    case "memory":
    case "workspace":
      return catalog.backgroundModel;
    default:
      return selected;
  }
}
