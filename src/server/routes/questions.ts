import { Hono } from "hono";
import type { SessionManager } from "../session-store";

export function createQuestionRoutes(sessionManager: SessionManager) {
  const app = new Hono();

  // Answer a pending question
  app.post("/:id/:qid", async (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    const questionId = c.req.param("qid");
    const deferred = session.pendingQuestions.get(questionId);
    if (!deferred) return c.json({ error: "No pending question with that ID" }, 404);

    const body = await c.req.json<{ answer: string; isCustom: boolean }>();
    deferred.resolve({ questionId, answer: body.answer, isCustom: body.isCustom });

    return c.json({ ok: true });
  });

  return app;
}
