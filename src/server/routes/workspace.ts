import { Hono } from "hono";
import { initWorkspace } from "@/lib/workspace/project";
import { scanWorkspace } from "@/lib/workspace/scan";

export function createWorkspaceRoutes() {
  const app = new Hono();

  app.post("/init", async (c) => {
    const { workspaceDir } = await c.req.json<{ workspaceDir: string }>();
    await initWorkspace({ workspaceDir });
    return c.json({ ok: true });
  });

  app.get("/scan", async (c) => {
    const workspaceDir = c.req.query("workspaceDir") ?? process.cwd();
    const result = await scanWorkspace(workspaceDir);
    return c.json(result.files.map((f) => ({ key: f.key, label: f.label })));
  });

  return app;
}
