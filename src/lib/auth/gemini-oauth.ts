// ── Gemini OAuth (Code Assist) ──────────────────────────────────────────────
// Uses the same OAuth credentials as the official Gemini CLI.
// Client ID/secret are public for installed apps per Google's policy.

export const GEMINI_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GEMINI_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GEMINI_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";
export const GEMINI_CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com";
export const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
export const GEMINI_CLIENT_SECRET = "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";
export const GEMINI_SCOPES = "https://www.googleapis.com/auth/cloud-platform openid email profile";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GeminiTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
}

// ── URL Builders ───────────────────────────────────────────────────────────

export function getGeminiRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/oauth2callback`;
}

export function buildGeminiAuthorizationUrl(input: {
  port: number;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: GEMINI_CLIENT_ID,
    response_type: "code",
    redirect_uri: getGeminiRedirectUri(input.port),
    scope: GEMINI_SCOPES,
    state: input.state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GEMINI_AUTH_URL}?${params}`;
}

// ── Token Exchange ─────────────────────────────────────────────────────────

export async function exchangeGeminiCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GeminiTokenResponse> {
  const response = await fetch(GEMINI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini token exchange failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<GeminiTokenResponse>;
}

// ── Token Refresh ──────────────────────────────────────────────────────────

export async function refreshGeminiAccessToken(
  refreshToken: string,
): Promise<GeminiTokenResponse> {
  const response = await fetch(GEMINI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini token refresh failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<GeminiTokenResponse>;
}

// ── User Info ──────────────────────────────────────────────────────────────

export async function getGeminiUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(`${GEMINI_USERINFO_URL}?alt=json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return "unknown";
  const data = (await response.json()) as { email?: string };
  return data.email ?? "unknown";
}

// ── Load Code Assist Project ───────────────────────────────────────────────

export async function loadCodeAssistProject(accessToken: string): Promise<string> {
  const response = await fetch(`${GEMINI_CODE_ASSIST_URL}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`loadCodeAssist failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    cloudaicompanionProject?: string | { id: string };
    allowedTiers?: Array<{ id?: string }>;
  };

  // Extract project ID
  const project = data.cloudaicompanionProject;
  if (typeof project === "string") return project;
  if (project && typeof project === "object" && "id" in project) return project.id;

  // No managed project — try onboarding
  if (data.allowedTiers?.length) {
    return onboardUser(accessToken);
  }

  throw new Error("Could not determine Gemini project ID. You may need a Google AI subscription.");
}

async function onboardUser(accessToken: string): Promise<string> {
  const response = await fetch(`${GEMINI_CODE_ASSIST_URL}/v1internal:onboardUser`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Gemini onboarding failed: ${response.status}`);
  }

  const data = (await response.json()) as { name?: string; done?: boolean; response?: { cloudaicompanionProject?: string } };

  // If operation is already done
  if (data.done && data.response?.cloudaicompanionProject) {
    return data.response.cloudaicompanionProject;
  }

  // Poll for completion
  if (data.name) {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const poll = await fetch(`${GEMINI_CODE_ASSIST_URL}/v1internal/${data.name}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!poll.ok) continue;
      const result = (await poll.json()) as { done?: boolean; response?: { cloudaicompanionProject?: string } };
      if (result.done && result.response?.cloudaicompanionProject) {
        return result.response.cloudaicompanionProject;
      }
    }
  }

  throw new Error("Gemini onboarding timed out. Try again.");
}
