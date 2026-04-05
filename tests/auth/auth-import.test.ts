import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildAuthorizationUrl,
  generateCodeChallenge,
} from "@/lib/auth/openai-oauth";
import { importCodexAuth } from "@/lib/auth/import-codex";
import { loadStoredAuth } from "@/lib/auth/store";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-auth-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("open research auth", () => {
  test("buildAuthorizationUrl includes PKCE and loopback redirect", () => {
    const redirectUri = "http://127.0.0.1:8787/callback";
    const url = new URL(
      buildAuthorizationUrl({
        redirectUri,
        state: "state-123",
        codeChallenge: generateCodeChallenge("verifier-123"),
      })
    );

    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
  });

  test("importCodexAuth refreshes an expired local codex session and stores it", async () => {
    const homeDir = await makeTempDir();
    const codexAuthPath = path.join(homeDir, ".codex", "auth.json");
    await fs.mkdir(path.dirname(codexAuthPath), { recursive: true });

    const expiredJwt = [
      "header",
      Buffer.from(JSON.stringify({ exp: 1 }), "utf8").toString("base64url"),
      "sig",
    ].join(".");

    await fs.writeFile(
      codexAuthPath,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: expiredJwt,
          refresh_token: "refresh-old",
          id_token: [
            "header",
            Buffer.from(
              JSON.stringify({ email: "researcher@example.com" }),
              "utf8"
            ).toString("base64url"),
            "sig",
          ].join("."),
          account_id: "acct_123",
        },
      }),
      "utf8"
    );

    const result = await importCodexAuth({
      homeDir,
      codexAuthFilePath: codexAuthPath,
      now: () => 2_000,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            access_token: [
              "header",
              Buffer.from(JSON.stringify({ exp: 3600 }), "utf8").toString(
                "base64url"
              ),
              "sig",
            ].join("."),
            refresh_token: "refresh-new",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    expect(result.accountId).toBe("acct_123");
    expect(result.refreshToken).toBe("refresh-new");

    const stored = await loadStoredAuth({ homeDir });
    expect(stored?.tokens.accountId).toBe("acct_123");
    expect(stored?.validation.status).toBe("degraded");
  });
});
