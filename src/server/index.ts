import { Hono } from "hono";
import { SessionManager } from "./session-store";
import { createSessionRoutes } from "./routes/sessions";
import { createEventRoutes } from "./routes/events";
import { createQuestionRoutes } from "./routes/questions";
import { createUpdateRoutes } from "./routes/updates";
import { createSnapshotRoutes } from "./routes/snapshots";
import { createWorkspaceRoutes } from "./routes/workspace";
import { createAuthRoutes } from "./routes/auth";
import { createConfigRoutes } from "./routes/config";
import { createSkillRoutes } from "./routes/skills";
import { createMemoryRoutes } from "./routes/memory";
import { createOntologyRoutes } from "./routes/ontology";

export function createApp(options?: { homeDir?: string }) {
  const app = new Hono();
  const sessionManager = new SessionManager();

  // Session-scoped routes
  app.route("/api/sessions", createSessionRoutes(sessionManager, options));
  app.route("/api/events", createEventRoutes(sessionManager));
  app.route("/api/questions", createQuestionRoutes(sessionManager));
  app.route("/api/updates", createUpdateRoutes(sessionManager));
  app.route("/api/snapshots", createSnapshotRoutes(sessionManager));

  // Global routes
  app.route("/api/workspace", createWorkspaceRoutes());
  app.route("/api/auth", createAuthRoutes(options));
  app.route("/api/config", createConfigRoutes(options));
  app.route("/api/skills", createSkillRoutes(options));
  app.route("/api/memory", createMemoryRoutes(options));
  app.route("/api/ontology", createOntologyRoutes());

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return { app, sessionManager };
}
