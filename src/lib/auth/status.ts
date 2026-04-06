import { validateOpenAIConnection } from "@/lib/llm/openai-connection";
import {
  getConfiguredProviderSummary,
  resolveConfiguredProvider,
} from "@/lib/llm/provider-resolution";
import { saveStoredAuth } from "./store";

export async function getAuthStatus(options?: { homeDir?: string }) {
  const resolved = await resolveConfiguredProvider({ homeDir: options?.homeDir });
  if (!resolved) {
    return {
      connected: false as const,
      message: "No OpenAI credentials configured. Set OPENAI_API_KEY, run /config apikey <key>, or run /auth.",
    };
  }

  if (resolved.kind === "openai_api_key") {
    return getConfiguredProviderSummary({ homeDir: options?.homeDir });
  }

  const stored = resolved.stored;
  const validation = await validateOpenAIConnection({
    accessToken: stored.tokens.access,
    refreshToken: stored.tokens.refresh,
    expiresAt: stored.tokens.expires,
    accountId: stored.tokens.accountId,
  });

  stored.validation = validation;
  stored.updatedAt = new Date().toISOString();
  await saveStoredAuth(stored, { homeDir: options?.homeDir });

  return {
    connected: validation.ok,
    message: validation.ok ? "Connected" : validation.lastErrorMessage ?? "Unavailable",
    validation,
    source: resolved.source,
    stored,
  };
}
