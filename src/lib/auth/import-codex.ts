import fs from "node:fs/promises";
import path from "node:path";
import {
  getBootstrapCredentialValidation,
  type StoredOpenAIAuth,
} from "@/lib/storage/credential-types";
import { saveStoredAuth } from "./store";
import { refreshAccessToken, decodeJwtPayload } from "./openai-oauth";

interface CodexAuthFile {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
}

export interface ImportCodexAuthOptions {
  homeDir?: string;
  codexAuthFilePath?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface ImportedCodexAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function getTokenExpiryMs(token: string): number {
  const claims = decodeJwtPayload(token);
  if (typeof claims.exp !== "number") {
    throw new Error("Local Codex auth is missing a token expiry.");
  }
  return claims.exp * 1000;
}

export async function importCodexAuth(
  options: ImportCodexAuthOptions = {}
): Promise<ImportedCodexAuth> {
  const now = options.now ?? Date.now;
  const codexAuthPath =
    options.codexAuthFilePath ??
    path.join(options.homeDir ?? process.env.HOME ?? "", ".codex", "auth.json");

  const parsed = JSON.parse(
    await fs.readFile(codexAuthPath, "utf8")
  ) as CodexAuthFile;

  if (parsed.auth_mode !== "chatgpt") {
    throw new Error("Codex is not signed in with OpenAI on this device.");
  }

  let accessToken = assertString(
    parsed.tokens?.access_token,
    "Codex auth is missing an access token."
  );
  let refreshToken = assertString(
    parsed.tokens?.refresh_token,
    "Codex auth is missing a refresh token."
  );
  const accountId = assertString(
    parsed.tokens?.account_id,
    "Codex auth is missing an account ID."
  );

  let expiresAt = getTokenExpiryMs(accessToken);
  if (expiresAt - now() < 30_000) {
    const originalFetch = globalThis.fetch;
    if (options.fetchImpl) {
      globalThis.fetch = options.fetchImpl;
    }
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token || refreshToken;
      expiresAt = now() + refreshed.expires_in * 1000;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  const timestamp = new Date(now()).toISOString();
  const stored: StoredOpenAIAuth = {
    provider: "openai_auth",
    tokens: {
      access: accessToken,
      refresh: refreshToken,
      expires: expiresAt,
      accountId,
    },
    validation: getBootstrapCredentialValidation(),
    importedFrom: "codex",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await saveStoredAuth(stored, { homeDir: options.homeDir });
  return {
    accessToken: stored.tokens.access,
    refreshToken: stored.tokens.refresh,
    expiresAt: stored.tokens.expires,
    accountId: stored.tokens.accountId,
  };
}
