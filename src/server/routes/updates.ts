import { Hono } from "hono";
import type { SessionManager } from "../session-store";
import { applyProposedUpdate } from "@/lib/workspace/apply-update";

export function createUpdateRoutes(sessionManager: SessionManager) {
  const app = new Hono();

  // Get pending updates
  app.get("/:id", (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json(session.pendingUpdates);
  });

  // Accept update
  app.post("/:id/:uid/accept", async (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    const updateId = c.req.param("uid");
    const index = session.pendingUpdates.findIndex((u) => u.id === updateId);
    if (index === -1) return c.json({ error: "Update not found" }, 404);

    const update = session.pendingUpdates[index]!;
    await applyProposedUpdate(session.workspaceDir, update);
    session.pendingUpdates.splice(index, 1);
    session.bus.emit({ type: "update_resolved", updateId, action: "accepted" });

    return c.json({ ok: true });
  });

  // Reject update
  app.post("/:id/:uid/reject", (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    const updateId = c.req.param("uid");
    const index = session.pendingUpdates.findIndex((u) => u.id === updateId);
    if (index === -1) return c.json({ error: "Update not found" }, 404);

    session.pendingUpdates.splice(index, 1);
    session.bus.emit({ type: "update_resolved", updateId, action: "rejected" });

    return c.json({ ok: true });
  });

  return app;
}
