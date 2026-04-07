import { loadStoredAuth, loadGeminiAuth, type StoredGeminiAuth } from "@/lib/auth/store";
import { loadOpenResearchConfig } from "@/lib/config/store";
import type { StoredOpenAIAuth } from "@/lib/storage/credential-types";

export type ProviderCredentialSource =
  | "env"
  | "providers.openai.apiKey"
  | "apiKeys.openai"
  | "providers.gemini.apiKey"
  | "apiKeys.gemini"
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
    }
  | {
      kind: "gemini_api_key";
      source: "env" | "providers.gemini.apiKey" | "apiKeys.gemini";
      apiKey: string;
    }
  | {
      kind: "gemini_auth";
      source: "stored_auth";
      stored: StoredGeminiAuth;
    };

function trimCredential(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// ── OpenAI Resolution ──────────────────────────────────────────────────────

function resolveOpenAI(
  stored: StoredOpenAIAuth | null,
  config: { providers?: { openai?: { apiKey?: string } }; apiKeys?: { openai?: string } } | null,
): ResolvedProvider | null {
  if (stored) {
    return { kind: "openai_auth", source: "stored_auth", stored };
  }

  const envKey = trimCredential(process.env.OPENAI_API_KEY);
  if (envKey) return { kind: "openai_api_key", source: "env", apiKey: envKey };

  const providerKey = trimCredential(config?.providers?.openai?.apiKey);
  if (providerKey) return { kind: "openai_api_key", source: "providers.openai.apiKey", apiKey: providerKey };

  const legacyKey = trimCredential(config?.apiKeys?.openai);
  if (legacyKey) return { kind: "openai_api_key", source: "apiKeys.openai", apiKey: legacyKey };

  return null;
}

// ── Gemini Resolution ──────────────────────────────────────────────────────

function resolveGemini(
  stored: StoredGeminiAuth | null,
  config: { providers?: { gemini?: { apiKey?: string } }; apiKeys?: { gemini?: string } } | null,
): ResolvedProvider | null {
  if (stored) {
    return { kind: "gemini_auth", source: "stored_auth", stored };
  }

  const envKey = trimCredential(process.env.GEMINI_API_KEY);
  if (envKey) return { kind: "gemini_api_key", source: "env", apiKey: envKey };

  const providerKey = trimCredential(config?.providers?.gemini?.apiKey);
  if (providerKey) return { kind: "gemini_api_key", source: "providers.gemini.apiKey", apiKey: providerKey };

  const legacyKey = trimCredential(config?.apiKeys?.gemini);
  if (legacyKey) return { kind: "gemini_api_key", source: "apiKeys.gemini", apiKey: legacyKey };

  return null;
}

// ── Main Resolution ────────────────────────────────────────────────────────

export async function resolveConfiguredProvider(options?: {
  homeDir?: string;
}): Promise<ResolvedProvider | null> {
  const [config, openaiStored, geminiStored] = await Promise.all([
    loadOpenResearchConfig({ homeDir: options?.homeDir }),
    loadStoredAuth({ homeDir: options?.homeDir }),
    loadGeminiAuth({ homeDir: options?.homeDir }),
  ]);

  const activeProvider = config?.activeProvider ?? "openai";

  // Try the active provider first, then fall through to the other
  if (activeProvider === "gemini") {
    return resolveGemini(geminiStored, config) ?? resolveOpenAI(openaiStored, config);
  }

  return resolveOpenAI(openaiStored, config) ?? resolveGemini(geminiStored, config);
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
      message: "No credentials configured. Run /auth (OpenAI), /auth-gemini (Google), or /config apikey <key>.",
    };
  }

  if (resolved.kind === "openai_auth") {
    return { connected: true, kind: resolved.kind, source: resolved.source, message: "OpenAI account connected." };
  }
  if (resolved.kind === "openai_api_key") {
    return { connected: true, kind: resolved.kind, source: resolved.source, message: `OpenAI API key configured via ${resolved.source}.` };
  }
  if (resolved.kind === "gemini_auth") {
    return { connected: true, kind: resolved.kind, source: resolved.source, message: `Google account connected (${resolved.stored.tokens.email}).` };
  }
  if (resolved.kind === "gemini_api_key") {
    return { connected: true, kind: resolved.kind, source: resolved.source, message: `Gemini API key configured via ${resolved.source}.` };
  }

  return { connected: false, message: "Unknown provider state." };
}
