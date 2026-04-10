import { describe, test, expect } from "vitest";
import { createApp } from "@/server/index";
import { DirectClient } from "@/server/client";

describe("DirectClient", () => {
  test("creates a session via DirectClient", async () => {
    const { app } = createApp();
    const client = new DirectClient(app);

    const session = await client.createSession("/tmp/test-workspace");
    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe("string");
  });

  test("round-trips session lifecycle via DirectClient", async () => {
    const { app } = createApp();
    const client = new DirectClient(app);

    // Create
    const session = await client.createSession("/tmp/test-workspace");
    expect(session.id).toBeDefined();

    // Delete
    await client.deleteSession(session.id);
  });

  test("gets pending updates via DirectClient", async () => {
    const { app, sessionManager } = createApp();
    const client = new DirectClient(app);

    const session = sessionManager.create("/tmp/test");
    session.pendingUpdates = [
      { id: "u1", type: "new", key: "note:x", content: "test", summary: "Test" },
    ];

    const updates = await client.getPendingUpdates(session.id);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("u1");
  });

  test("rejects update via DirectClient", async () => {
    const { app, sessionManager } = createApp();
    const client = new DirectClient(app);

    const session = sessionManager.create("/tmp/test");
    session.pendingUpdates = [
      { id: "u1", type: "new", key: "note:x", content: "test", summary: "Test" },
    ];

    await client.rejectUpdate(session.id, "u1");
    expect(session.pendingUpdates).toHaveLength(0);
  });
});
