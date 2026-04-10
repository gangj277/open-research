import { Hono } from "hono";
import { loadAllMemories, deleteMemory, clearMemories } from "@/lib/memory/store";

export function createMemoryRoutes(options?: { homeDir?: string }) {
  const app = new Hono();

  app.get("/", async (c) => {
    const memories = await loadAllMemories(options);
    return c.json(memories);
  });

  app.delete("/clear", async (c) => {
    await clearMemories(options);
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await deleteMemory(id, options);
    return c.json({ ok: deleted });
  });

  return app;
}
