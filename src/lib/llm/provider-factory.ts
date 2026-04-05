import { loadStoredAuth, saveStoredAuth } from "@/lib/auth/store";
import type { LLMProvider } from "./provider";
import { createOpenAIAuthProvider } from "./providers/openai-auth";

export async function createProviderFromStoredAuth(options?: {
  homeDir?: string;
}): Promise<LLMProvider> {
  const stored = await loadStoredAuth({ homeDir: options?.homeDir });
  if (!stored) {
    throw new Error("No OpenAI account connected. Run `open-research auth login`.");
  }

  return createOpenAIAuthProvider(
    {
      accessToken: stored.tokens.access,
      refreshToken: stored.tokens.refresh,
      expiresAt: stored.tokens.expires,
      accountId: stored.tokens.accountId,
    },
    async (newCreds) => {
      stored.tokens.access = newCreds.accessToken;
      stored.tokens.refresh = newCreds.refreshToken;
      stored.tokens.expires = newCreds.expiresAt;
      stored.tokens.accountId = newCreds.accountId;
      stored.updatedAt = new Date().toISOString();
      await saveStoredAuth(stored, { homeDir: options?.homeDir });
    },
    async (validation) => {
      stored.validation = validation;
      stored.updatedAt = new Date().toISOString();
      await saveStoredAuth(stored, { homeDir: options?.homeDir });
    }
  );
}
