import { describe, test, expect, beforeEach } from "vitest";
import { createApp } from "@/server/index";

let app: ReturnType<typeof createApp>["app"];
let sessionManager: ReturnType<typeof createApp>["sessionManager"];

beforeEach(() => {
  const created = createApp();
  app = created.app;
  sessionManager = created.sessionManager;
});

describe("Server Routes", () => {
  test("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  describe("Session routes", () => {
    test("POST /api/sessions creates a session", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceDir: "/tmp/test-workspace" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe("string");
    });

    test("DELETE /api/sessions/:id deletes a session", async () => {
      const session = sessionManager.create("/tmp/test");
      const res = await app.request(`/api/sessions/${session.id}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(sessionManager.get(session.id)).toBeUndefined();
    });
  });

  describe("Update routes", () => {
    test("GET /api/updates/:id returns pending updates", async () => {
      const session = sessionManager.create("/tmp/test");
      session.pendingUpdates = [
        { id: "u1", type: "new", key: "note:test", content: "hello", summary: "Test note" },
      ];
      const res = await app.request(`/api/updates/${session.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("u1");
    });

    test("POST /api/updates/:id/:uid/reject removes the update", async () => {
      const session = sessionManager.create("/tmp/test");
      session.pendingUpdates = [
        { id: "u1", type: "new", key: "note:test", content: "hello", summary: "Test note" },
      ];
      const res = await app.request(`/api/updates/${session.id}/u1/reject`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(session.pendingUpdates).toHaveLength(0);
    });
  });

  describe("Question routes", () => {
    test("POST /api/questions/:id/:qid resolves pending question", async () => {
      const session = sessionManager.create("/tmp/test");
      const bridge = sessionManager.createQuestionBridge(session);

      // Start a question in the background
      const questionPromise = bridge.createQuestion({
        id: "q1",
        question: "Pick color?",
        options: [{ label: "Red", description: "A red color" }],
      });

      // Answer it via the API
      const res = await app.request(`/api/questions/${session.id}/q1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "Red", isCustom: false }),
      });
      expect(res.status).toBe(200);

      // The bridge promise should resolve
      const answer = await questionPromise;
      expect(answer.answer).toBe("Red");
      expect(answer.isCustom).toBe(false);
    });
  });
});
