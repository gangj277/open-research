import { validateOpenAIConnection } from "@/lib/llm/openai-connection";
import { loadStoredAuth, saveStoredAuth } from "./store";

export async function getAuthStatus(options?: { homeDir?: string }) {
  const stored = await loadStoredAuth({ homeDir: options?.homeDir });
  if (!stored) {
    return {
      connected: false as const,
      message: "No OpenAI auth stored.",
    };
  }

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
    stored,
  };
}
