import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { decodeJwtPayload, refreshAccessToken } from "./openai-oauth";

export interface LocalCodexAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  expiresAt: number;
}

interface CodexAuthFile {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
}

function getAuthFilePath(): string {
  return process.env.CODEX_AUTH_FILE || path.join(os.homedir(), ".codex", "auth.json");
}

function getTokenExpiryMs(token: string): number {
  const claims = decodeJwtPayload(token);
  const exp = claims.exp;

  if (typeof exp !== "number") {
    throw new Error("Local Codex auth is missing a token expiry. Run `codex login` again.");
  }

  return exp * 1000;
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value;
}

export async function readLocalCodexAuthTokens(): Promise<LocalCodexAuthTokens> {
  const authFilePath = getAuthFilePath();

  let raw: string;
  try {
    raw = await fs.readFile(authFilePath, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";

    if (code === "ENOENT") {
      throw new Error(
        "No local OpenAI session found. Run `codex login` on this device and try again."
      );
    }

    throw new Error("Failed to read the local Codex auth state. Try again.");
  }

  let parsed: CodexAuthFile;
  try {
    parsed = JSON.parse(raw) as CodexAuthFile;
  } catch {
    throw new Error("Local Codex auth is corrupted. Run `codex login` again.");
  }

  if (parsed.auth_mode !== "chatgpt") {
    throw new Error(
      "Codex is not signed in with OpenAI on this device. Run `codex logout`, then `codex login`, and try again."
    );
  }

  const accessToken = assertString(
    parsed.tokens?.access_token,
    "Local Codex auth is missing an access token. Run `codex login` again."
  );
  let refreshToken = assertString(
    parsed.tokens?.refresh_token,
    "Local Codex auth is missing a refresh token. Run `codex login` again."
  );
  const idToken = assertString(
    parsed.tokens?.id_token,
    "Local Codex auth is missing an ID token. Run `codex login` again."
  );
  const accountId = assertString(
    parsed.tokens?.account_id,
    "Local Codex auth is missing an account ID. Run `codex login` again."
  );

  let currentAccessToken = accessToken;
  let expiresAt = getTokenExpiryMs(currentAccessToken);

  if (expiresAt - Date.now() < 30_000) {
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      currentAccessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token || refreshToken;
      expiresAt = Date.now() + refreshed.expires_in * 1000;
    } catch {
      throw new Error(
        "Your local OpenAI session expired. Run `codex login` again and retry."
      );
    }
  }

  return {
    accessToken: currentAccessToken,
    refreshToken,
    idToken,
    accountId,
    expiresAt,
  };
}
