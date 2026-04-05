import http from "node:http";
import { once } from "node:events";
import open from "open";
import { getBootstrapCredentialValidation, type StoredOpenAIAuth } from "@/lib/storage/credential-types";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getRedirectUri,
  decodeJwtPayload,
} from "./openai-oauth";
import { saveStoredAuth } from "./store";

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractAccountId(
  accessClaims: Record<string, unknown>,
  idClaims: Record<string, unknown>
): string {
  const authClaims = accessClaims["https://api.openai.com/auth"];
  const idAuthClaims = idClaims["https://api.openai.com/auth"];
  if (authClaims && typeof authClaims === "object") {
    const fromAccess = readString(
      (authClaims as Record<string, unknown>).chatgpt_account_id
    );
    if (fromAccess) return fromAccess;
  }
  if (idAuthClaims && typeof idAuthClaims === "object") {
    const fromId = readString(
      (idAuthClaims as Record<string, unknown>).chatgpt_account_id
    );
    if (fromId) return fromId;
  }
  return readString(accessClaims.account_id) || readString(accessClaims.sub);
}

async function listenForCallback(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  server.listen(0, "localhost");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind OpenAI OAuth callback server.");
  }
  return { server, port: address.port };
}

export async function loginWithBrowser(options?: { homeDir?: string }) {
  const { server, port } = await listenForCallback();
  const redirectUri = getRedirectUri(port);
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();
  const url = buildAuthorizationUrl({
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OpenAI OAuth callback."));
    }, 180_000);

    server.on("request", (req, res) => {
      if (!req.url) {
        return;
      }
      const reqUrl = new URL(req.url, redirectUri);
      if (reqUrl.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      if (reqUrl.searchParams.get("state") !== state) {
        clearTimeout(timeout);
        res.statusCode = 400;
        res.end("State mismatch. You can close this tab.");
        server.close();
        reject(new Error("OpenAI OAuth state mismatch."));
        return;
      }
      const authCode = reqUrl.searchParams.get("code");
      if (!authCode) {
        clearTimeout(timeout);
        res.statusCode = 400;
        res.end("Missing code. You can close this tab.");
        server.close();
        reject(new Error("OpenAI OAuth callback did not include a code."));
        return;
      }
      clearTimeout(timeout);
      res.statusCode = 200;
      res.end("Open Research login complete. You can close this tab.");
      server.close();
      resolve(authCode);
    });
  });

  await open(url);
  const code = await codePromise;
  const tokens = await exchangeCodeForTokens(code, verifier, redirectUri);
  const accessClaims = decodeJwtPayload(tokens.access_token);
  const idClaims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : {};
  const accountId = extractAccountId(accessClaims, idClaims);
  if (!accountId) {
    throw new Error("Missing OpenAI account ID in OAuth response.");
  }

  const timestamp = new Date().toISOString();
  const stored: StoredOpenAIAuth = {
    provider: "openai_auth",
    tokens: {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + tokens.expires_in * 1000,
      accountId,
    },
    validation: getBootstrapCredentialValidation(),
    importedFrom: "oauth",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await saveStoredAuth(stored, { homeDir: options?.homeDir });
  return stored;
}
