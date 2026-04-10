import { Hono } from "hono";
import type { SessionManager } from "../session-store";
import { TurnManager } from "@/lib/snapshot";

// Per-session TurnManagers (created lazily)
const turnManagers = new Map<string, TurnManager>();

function getTurnManager(session: { id: string; workspaceDir: string }): TurnManager {
  let tm = turnManagers.get(session.id);
  if (!tm) {
    tm = new TurnManager(session.workspaceDir);
    turnManagers.set(session.id, tm);
    void tm.init().catch(() => {});
  }
  return tm;
}

export function createSnapshotRoutes(sessionManager: SessionManager) {
  const app = new Hono();

  // List turn snapshots
  app.get("/:id", (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    const tm = getTurnManager(session);
    return c.json(
      tm.getTurnSnapshots().map((s) => ({
        turnIndex: s.turnIndex,
        patch: s.patch,
        timestamp: s.timestamp,
      }))
    );
  });

  // Revert to a turn
  app.post("/:id/revert", async (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    const { afterTurn } = await c.req.json<{ afterTurn: number }>();
    const tm = getTurnManager(session);

    try {
      const result = await tm.revertToTurn(afterTurn);
      session.bus.emit({
        type: "snapshot_reverted",
        revertedTurns: result.revertedTurns,
        filesRestored: result.filesRestored,
      });
      return c.json({ revertedTurns: result.revertedTurns, filesRestored: result.filesRestored });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Unrevert
  app.post("/:id/unrevert", async (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    const tm = getTurnManager(session);
    try {
      await tm.unrevert();
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return app;
}
