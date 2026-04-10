import { Hono } from "hono";
import { getAuthStatus } from "@/lib/auth/status";
import { loginWithBrowser } from "@/lib/auth/login";
import { importCodexAuth } from "@/lib/auth/import-codex";
import { clearStoredAuth } from "@/lib/auth/store";

export function createAuthRoutes(options?: { homeDir?: string }) {
  const app = new Hono();

  app.get("/status", async (c) => {
    const status = await getAuthStatus(options);
    return c.json(status);
  });

  app.post("/login", async (c) => {
    const stored = await loginWithBrowser(options);
    return c.json({ ok: true, provider: stored.provider });
  });

  app.post("/login-gemini", async (c) => {
    const { loginWithGemini } = await import("@/lib/auth/gemini-login");
    const stored = await loginWithGemini(options);
    return c.json({ ok: true, provider: stored.provider });
  });

  app.post("/import-codex", async (c) => {
    const result = await importCodexAuth({ homeDir: options?.homeDir });
    return c.json({ ok: true, accountId: result.accountId });
  });

  app.post("/logout", async (c) => {
    await clearStoredAuth(options);
    return c.json({ ok: true });
  });

  return app;
}
