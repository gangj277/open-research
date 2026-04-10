import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionManager } from "../session-store";

export function createEventRoutes(sessionManager: SessionManager) {
  const app = new Hono();

  // SSE stream for session events
  app.get("/:id", async (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    return streamSSE(c, async (stream) => {
      const unsubscribe = session.bus.subscribe((event) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      });

      // Heartbeat every 10s
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ data: '{"type":"heartbeat"}' });
      }, 10_000);

      // Wait until client disconnects
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Keep the stream open
      await new Promise(() => {});
    });
  });

  return app;
}
