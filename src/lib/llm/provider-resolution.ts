import { loadStoredAuth } from "@/lib/auth/store";
import { loadOpenResearchConfig } from "@/lib/config/store";
import type { StoredOpenAIAuth } from "@/lib/storage/credential-types";

export type ProviderCredentialSource =
  | "env"
  | "providers.openai.apiKey"
  | "apiKeys.openai"
  | "stored_auth";

export type ResolvedProvider =
  | {
      kind: "openai_api_key";
      source: "env" | "providers.openai.apiKey" | "apiKeys.openai";
      apiKey: string;
    }
  | {
      kind: "openai_auth";
      source: "stored_auth";
      stored: StoredOpenAIAuth;
    };

function trimCredential(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveConfiguredProvider(options?: {
  homeDir?: string;
}): Promise<ResolvedProvider | null> {
  const [config, stored] = await Promise.all([
    loadOpenResearchConfig({ homeDir: options?.homeDir }),
    loadStoredAuth({ homeDir: options?.homeDir }),
  ]);

  if (stored) {
    return {
      kind: "openai_auth",
      source: "stored_auth",
      stored,
    };
  }

  const envKey = trimCredential(process.env.OPENAI_API_KEY);
  if (envKey) {
    return {
      kind: "openai_api_key",
      source: "env",
      apiKey: envKey,
    };
  }

  const providerKey = trimCredential(config?.providers?.openai?.apiKey);
  if (providerKey) {
    return {
      kind: "openai_api_key",
      source: "providers.openai.apiKey",
      apiKey: providerKey,
    };
  }

  const legacyKey = trimCredential(config?.apiKeys?.openai);
  if (legacyKey) {
    return {
      kind: "openai_api_key",
      source: "apiKeys.openai",
      apiKey: legacyKey,
    };
  }

  return null;
}

export async function hasConfiguredProvider(options?: {
  homeDir?: string;
}): Promise<boolean> {
  return (await resolveConfiguredProvider(options)) !== null;
}

export async function getConfiguredProviderSummary(options?: {
  homeDir?: string;
}): Promise<{
  connected: boolean;
  kind?: ResolvedProvider["kind"];
  source?: ProviderCredentialSource;
  message: string;
}> {
  const resolved = await resolveConfiguredProvider(options);
  if (!resolved) {
    return {
      connected: false,
      message:
        "No OpenAI credentials configured. Set OPENAI_API_KEY, run /config apikey <key>, or run /auth.",
    };
  }

  if (resolved.kind === "openai_auth") {
    return {
      connected: true,
      kind: resolved.kind,
      source: resolved.source,
      message: "OpenAI account connected.",
    };
  }

  const sourceMessage =
    resolved.source === "env"
      ? "OPENAI_API_KEY"
      : resolved.source === "providers.openai.apiKey"
        ? "providers.openai.apiKey"
        : "apiKeys.openai";

  return {
    connected: true,
    kind: resolved.kind,
    source: resolved.source,
    message: `OpenAI API key configured via ${sourceMessage}.`,
  };
}
