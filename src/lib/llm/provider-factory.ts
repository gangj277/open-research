import { loadStoredAuth, saveStoredAuth } from "@/lib/auth/store";
import type { LLMProvider } from "./provider";
import { createOpenAIAuthProvider } from "./providers/openai-auth";
import { createOpenAIAPIKeyProvider } from "./providers/openai-api-key";
import { resolveConfiguredProvider } from "./provider-resolution";

/**
 * Create an LLM provider using the best available credentials.
 *
 * Resolution order:
 * 1. Stored OAuth credentials → Codex OAuth API (free with ChatGPT subscription)
 * 2. OPENAI_API_KEY environment variable → OpenAI Responses API
 * 3. config.apiKeys.openai → OpenAI Responses API
 * 4. Error
 */
export async function createProviderFromStoredAuth(options?: {
  homeDir?: string;
}): Promise<LLMProvider> {
  const resolved = await resolveConfiguredProvider({ homeDir: options?.homeDir });
  if (!resolved) {
    throw new Error(
      "No OpenAI credentials found. Run /auth to connect via OAuth (free), set OPENAI_API_KEY, or run /config apikey <key>."
    );
  }

  if (resolved.kind === "openai_auth") {
    const stored = resolved.stored;
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

  return createOpenAIAPIKeyProvider(resolved.apiKey);
}
