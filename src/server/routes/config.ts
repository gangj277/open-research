import { Hono } from "hono";
import { ensureOpenResearchConfig, saveOpenResearchConfig } from "@/lib/config/store";
import { getAvailableModels } from "@/lib/llm/provider-catalog";

export function createConfigRoutes(options?: { homeDir?: string }) {
  const app = new Hono();

  app.get("/", async (c) => {
    const config = await ensureOpenResearchConfig(options);
    return c.json(config);
  });

  app.put("/", async (c) => {
    const body = await c.req.json();
    await saveOpenResearchConfig(body, options);
    return c.json({ ok: true });
  });

  app.get("/models", (c) => {
    const models = getAvailableModels();
    return c.json(models);
  });

  return app;
}
