import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionManager } from "../session-store";
import { listSessions, loadSessionHistory, appendSessionEvent } from "@/lib/workspace/sessions";
import { runAgentTurn } from "@/lib/agent/runtime";
import { createProviderFromStoredAuth } from "@/lib/llm/provider-factory";
import { scanWorkspace } from "@/lib/workspace/scan";
import { classifyUpdateRisk } from "@/lib/agent/review-policy";
import { applyProposedUpdate } from "@/lib/workspace/apply-update";
import type { ServerEvent } from "../types";

export function createSessionRoutes(sessionManager: SessionManager, options?: { homeDir?: string }) {
  const app = new Hono();

  // Create session
  app.post("/", async (c) => {
    const { workspaceDir } = await c.req.json<{ workspaceDir: string }>();
    const session = sessionManager.create(workspaceDir);
    return c.json({ id: session.id });
  });

  // List sessions
  app.get("/", async (c) => {
    const workspaceDir = c.req.query("workspaceDir");
    if (!workspaceDir) return c.json([]);
    const sessions = await listSessions(workspaceDir);
    return c.json(sessions);
  });

  // Get session history
  app.get("/:id/history", async (c) => {
    const sessionId = c.req.param("id");
    const session = sessionManager.get(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const restored = await loadSessionHistory(session.workspaceDir, sessionId);
    return c.json(restored);
  });

  // Delete session
  app.delete("/:id", (c) => {
    const sessionId = c.req.param("id");
    sessionManager.delete(sessionId);
    return c.json({ ok: true });
  });

  // Send message — streams ServerEvents as SSE
  app.post("/:id/message", async (c) => {
    const sessionId = c.req.param("id");
    const session = sessionManager.get(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);

    const body = await c.req.json<{
      message: string;
      model?: string;
      reasoningEffort?: string;
      agentMode?: string;
    }>();

    const controller = new AbortController();
    session.abortController = controller;

    return streamSSE(c, async (stream) => {
      const sink = (event: ServerEvent) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      };

      const questionBridge = sessionManager.createQuestionBridge(session);
      const eventSink = sessionManager.createEventSink(session);

      try {
        const provider = await createProviderFromStoredAuth({ homeDir: options?.homeDir });
        const workspace = await scanWorkspace(session.workspaceDir);
        const workspaceContext = {
          workspaceDir: session.workspaceDir,
          runId: sessionId,
          workspaceFiles: Object.fromEntries(workspace.files.map((f) => [f.key, f.content])),
          availableKeys: workspace.files.map((f) => f.key),
          fileLabels: Object.fromEntries(workspace.files.map((f) => [f.key, f.label])),
        };

        const result = await runAgentTurn({
          provider,
          message: body.message,
          history: session.history,
          workspace: workspaceContext,
          homeDir: options?.homeDir,
          model: body.model,
          reasoningEffort: body.reasoningEffort as "low" | "medium" | "high" | "xhigh" | undefined,
          activeSkills: session.activeSkills,
          signal: controller.signal,
          questionBridge,
          eventSink: (event) => {
            sink(event);
            eventSink(event);
          },
          onTextDelta: (chunk) => sink({ type: "text_delta", content: chunk }),
          onToolActivity: (activity) => sink({ type: "tool_activity", activity }),
          onSubAgentProgress: (progress) => sink({ type: "subagent_progress", progress }),
          onCompaction: () => sink({ type: "context_compacted", scope: "history", estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
          onTokenUpdate: (usage) => sink({ type: "token_update", usage }),
          onMemoryExtracted: (memories) => sink({ type: "memory_extracted", memories }),
        });

        // Update session state
        session.history.push(
          { role: "user", content: body.message },
          { role: "assistant", content: result.text }
        );
        session.activeSkills = result.activeSkills;
        session.tokenUsage = result.tokenUsage;

        // Handle proposed updates
        for (const update of result.proposedUpdates) {
          const policy = classifyUpdateRisk(update);
          if (body.agentMode === "auto-approve" || policy.policy === "auto-apply") {
            await applyProposedUpdate(session.workspaceDir, update);
          } else {
            session.pendingUpdates.push(update);
            sink({ type: "proposed_update", update });
          }
        }

        // Persist session event
        await appendSessionEvent(session.workspaceDir, sessionId, {
          type: "chat.turn",
          timestamp: new Date().toISOString(),
          payload: {
            prompt: body.message,
            response: result.text,
            proposedUpdates: result.proposedUpdates.map((u) => ({ key: u.key, summary: u.summary })),
          },
        });

        sink({ type: "done", usage: result.tokenUsage });
      } catch (error) {
        sink({ type: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        session.abortController = null;
        await stream.writeSSE({ data: "[DONE]" });
      }
    });
  });

  // Abort
  app.post("/:id/abort", (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    session.abortController?.abort();
    return c.json({ ok: true });
  });

  // Compact
  app.post("/:id/compact", async (c) => {
    const session = sessionManager.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    const { manualCompact } = await import("@/lib/agent/context-manager");
    const provider = await createProviderFromStoredAuth({ homeDir: options?.homeDir });
    const compacted = await manualCompact(session.history, provider, { homeDir: options?.homeDir });
    session.history = compacted.messages;
    return c.json({ ok: true });
  });

  return app;
}
