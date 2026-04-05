import { createHash, randomBytes } from "crypto";

// ─── OpenAI Codex OAuth Configuration ────────────────────────────────────────

export const OPENAI_AUTH_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_SCOPES = "openid profile email offline_access";

export function getRedirectUri(port: number): string {
  return `http://localhost:${port}/auth/callback`;
}

// ─── PKCE Helpers ────────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ─── Authorization URL Builder ───────────────────────────────────────────────

export function buildAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: OPENAI_SCOPES,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "open-research",
  });

  return `${OPENAI_AUTH_URL}?${params.toString()}`;
}

// ─── Token Exchange ──────────────────────────────────────────────────────────

export interface OpenAITokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<OpenAITokenResponse> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${error}`);
  }

  return response.json() as Promise<OpenAITokenResponse>;
}

// ─── Token Refresh ───────────────────────────────────────────────────────────

export async function refreshAccessToken(
  refreshToken: string
): Promise<OpenAITokenResponse> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OPENAI_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${error}`);
  }

  return response.json() as Promise<OpenAITokenResponse>;
}

// ─── JWT Decode (extract claims without verification) ────────────────────────

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Invalid JWT format");
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}
