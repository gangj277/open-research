import http from "node:http";
import crypto from "node:crypto";
import {
  buildGeminiAuthorizationUrl,
  getGeminiRedirectUri,
  exchangeGeminiCodeForTokens,
  getGeminiUserEmail,
  loadCodeAssistProject,
} from "./gemini-oauth";
import { saveGeminiAuth, type StoredGeminiAuth } from "./store";

/**
 * Log in to Google via browser OAuth (Gemini Code Assist).
 * Opens a browser window, waits for the callback, exchanges the code for tokens,
 * discovers the managed project, and saves credentials.
 */
export async function loginWithGemini(options?: {
  homeDir?: string;
}): Promise<StoredGeminiAuth> {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString("hex");

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1`);

        if (url.pathname !== "/oauth2callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Authentication failed</h2><p>${error}</p><p>You can close this tab.</p></body></html>`);
          server.close();
          reject(new Error(`Google OAuth error: ${error}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Invalid callback</h2><p>Missing code or state mismatch.</p></body></html>");
          server.close();
          reject(new Error("Invalid OAuth callback"));
          return;
        }

        const port = (server.address() as { port: number }).port;
        const redirectUri = getGeminiRedirectUri(port);

        // Exchange code for tokens
        const tokenResponse = await exchangeGeminiCodeForTokens(code, redirectUri);

        // Get user email
        const email = await getGeminiUserEmail(tokenResponse.access_token);

        // Discover managed project
        const projectId = await loadCodeAssistProject(tokenResponse.access_token);

        const now = new Date().toISOString();
        const stored: StoredGeminiAuth = {
          provider: "gemini_auth",
          tokens: {
            access: tokenResponse.access_token,
            refresh: tokenResponse.refresh_token ?? "",
            expires: Date.now() + tokenResponse.expires_in * 1000,
            email,
            projectId,
          },
          createdAt: now,
          updatedAt: now,
        };

        await saveGeminiAuth(stored, { homeDir: options?.homeDir });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Connected to Google</h2><p>${email}</p><p>You can close this tab and return to Open Research.</p></body></html>`);
        server.close();
        resolve(stored);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Error</h2><p>Authentication failed. Check the CLI for details.</p></body></html>");
        server.close();
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", async () => {
      const port = (server.address() as { port: number }).port;
      const authUrl = buildGeminiAuthorizationUrl({ port, state });

      try {
        const openModule = await import("open");
        await openModule.default(authUrl);
      } catch {
        // If open fails, user can manually copy the URL
        console.log(`Open this URL in your browser:\n${authUrl}`);
      }
    });

    server.on("error", reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Gemini login timed out (5 min). Try again."));
    }, 300_000);
  });
}
