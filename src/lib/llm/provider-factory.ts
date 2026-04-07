import { loadStoredAuth, saveStoredAuth, saveGeminiAuth } from "@/lib/auth/store";
import type { LLMProvider } from "./provider";
import { createOpenAIAuthProvider } from "./providers/openai-auth";
import { createOpenAIAPIKeyProvider } from "./providers/openai-api-key";
import { createGeminiAuthProvider } from "./providers/gemini-auth";
import { createGeminiAPIKeyProvider } from "./providers/gemini-api-key";
import { resolveConfiguredProvider } from "./provider-resolution";

/**
 * Create an LLM provider using the best available credentials.
 *
 * Resolution order (respects config.activeProvider):
 * 1. Active provider's stored OAuth / env / config credentials
 * 2. Fallback to other provider's credentials
 * 3. Error
 */
export async function createProviderFromStoredAuth(options?: {
  homeDir?: string;
}): Promise<LLMProvider> {
  const resolved = await resolveConfiguredProvider({ homeDir: options?.homeDir });
  if (!resolved) {
    throw new Error(
      "No credentials found. Run /auth (OpenAI), /auth-gemini (Google), or /config apikey <key>."
    );
  }

  // ── OpenAI OAuth ─────────────────────────────────────────────────────
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

  // ── OpenAI API Key ───────────────────────────────────────────────────
  if (resolved.kind === "openai_api_key") {
    return createOpenAIAPIKeyProvider(resolved.apiKey);
  }

  // ── Gemini OAuth ─────────────────────────────────────────────────────
  if (resolved.kind === "gemini_auth") {
    const stored = resolved.stored;
    return createGeminiAuthProvider(
      {
        accessToken: stored.tokens.access,
        refreshToken: stored.tokens.refresh,
        expiresAt: stored.tokens.expires,
        email: stored.tokens.email,
        projectId: stored.tokens.projectId,
      },
      async (newCreds) => {
        stored.tokens.access = newCreds.accessToken;
        stored.tokens.refresh = newCreds.refreshToken;
        stored.tokens.expires = newCreds.expiresAt;
        stored.updatedAt = new Date().toISOString();
        await saveGeminiAuth(stored, { homeDir: options?.homeDir });
      },
    );
  }

  // ── Gemini API Key ───────────────────────────────────────────────────
  if (resolved.kind === "gemini_api_key") {
    return createGeminiAPIKeyProvider(resolved.apiKey);
  }

  throw new Error("Unknown provider kind.");
}
