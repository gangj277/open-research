import type { Hono } from "hono";
import type {
  ServerClient,
  ServerEvent,
  SendMessageOptions,
} from "./types";
import type { AskUserAnswer, ProposedUpdate } from "@/lib/agent/state";
import type { LLMMessage } from "@/lib/llm/types";
import type { SnapshotPatch } from "@/lib/snapshot/types";

// ── Direct Client ──────────────────────────────────────────────────────────
// Calls app.request() in-process (no HTTP overhead).
// Used when the TUI and server run in the same process.

export class DirectClient implements ServerClient {
  constructor(private app: Hono) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `http://localhost${path}`;
    return this.app.request(url, init);
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async void_(path: string, init?: RequestInit): Promise<void> {
    const res = await this.request(path, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
  }

  // ── Session ──

  async createSession(workspaceDir: string) {
    return this.json<{ id: string }>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceDir }),
    });
  }

  async listSessions(workspaceDir: string) {
    return this.json<Array<{ id: string; startedAt: string; lastActivity: string; preview: string; turnCount: number }>>(
      `/api/sessions?workspaceDir=${encodeURIComponent(workspaceDir)}`
    );
  }

  async getSessionHistory(sessionId: string) {
    return this.json<{ messages: Array<{ role: string; text: string }>; llmHistory: LLMMessage[] }>(
      `/api/sessions/${sessionId}/history`
    );
  }

  async deleteSession(sessionId: string) {
    await this.void_(`/api/sessions/${sessionId}`, { method: "DELETE" });
  }

  // ── Prompting ──

  async *sendMessage(
    sessionId: string,
    message: string,
    options?: SendMessageOptions
  ): AsyncIterable<ServerEvent> {
    const res = await this.request(`/api/sessions/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, ...options }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }

    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data) as ServerEvent;
          } catch {
            // Skip malformed events
          }
        }
      }
    }
  }

  async abort(sessionId: string) {
    await this.void_(`/api/sessions/${sessionId}/abort`, { method: "POST" });
  }

  async compact(sessionId: string) {
    await this.void_(`/api/sessions/${sessionId}/compact`, { method: "POST" });
  }

  // ── Questions ──

  async answerQuestion(sessionId: string, questionId: string, answer: AskUserAnswer) {
    await this.void_(`/api/questions/${sessionId}/${questionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answer),
    });
  }

  // ── Proposed Updates ──

  async getPendingUpdates(sessionId: string) {
    return this.json<ProposedUpdate[]>(`/api/updates/${sessionId}`);
  }

  async acceptUpdate(sessionId: string, updateId: string) {
    await this.void_(`/api/updates/${sessionId}/${updateId}/accept`, { method: "POST" });
  }

  async rejectUpdate(sessionId: string, updateId: string) {
    await this.void_(`/api/updates/${sessionId}/${updateId}/reject`, { method: "POST" });
  }

  // ── Snapshots ──

  async getSnapshots(sessionId: string) {
    return this.json<Array<{ turnIndex: number; patch: SnapshotPatch; timestamp: string }>>(
      `/api/snapshots/${sessionId}`
    );
  }

  async revert(sessionId: string, afterTurn: number) {
    return this.json<{ revertedTurns: number[]; filesRestored: string[] }>(
      `/api/snapshots/${sessionId}/revert`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterTurn }),
      }
    );
  }

  async unrevert(sessionId: string) {
    await this.void_(`/api/snapshots/${sessionId}/unrevert`, { method: "POST" });
  }

  // ── Workspace ──

  async initWorkspace(workspaceDir: string) {
    await this.void_("/api/workspace/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceDir }),
    });
  }

  async scanWorkspace(workspaceDir: string) {
    return this.json<Array<{ key: string; label: string }>>(
      `/api/workspace/scan?workspaceDir=${encodeURIComponent(workspaceDir)}`
    );
  }

  // ── Auth ──

  async getAuthStatus() {
    return this.json<{ status: "missing" | "connected"; provider?: string }>("/api/auth/status");
  }

  async login() {
    await this.void_("/api/auth/login", { method: "POST" });
  }

  async loginGemini() {
    await this.void_("/api/auth/login-gemini", { method: "POST" });
  }

  async importCodex() {
    await this.void_("/api/auth/import-codex", { method: "POST" });
  }

  async logout() {
    await this.void_("/api/auth/logout", { method: "POST" });
  }

  // ── Config ──

  async getConfig() {
    return this.json<Record<string, unknown>>("/api/config");
  }

  async updateConfig(updates: Record<string, unknown>) {
    await this.void_("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }

  async getModels() {
    return this.json<Array<{ id: string; name: string; contextWindow: number }>>("/api/config/models");
  }

  // ── Skills ──

  async listSkills() {
    return this.json<Array<{ name: string; description: string }>>("/api/skills");
  }

  // ── Memory ──

  async listMemories() {
    return this.json<Array<{ id: string; content: string; category: string; scope: string }>>("/api/memory");
  }

  async deleteMemory(id: string) {
    await this.void_(`/api/memory/${id}`, { method: "DELETE" });
  }

  async clearMemories() {
    await this.void_("/api/memory", { method: "DELETE" });
  }

  // ── Ontology ──

  async getOntologyStatus() {
    return this.json<{ noteCount: number; edgeCount: number }>("/api/ontology/status");
  }
}

// ── HTTP Client ────────────────────────────────────────────────────────────
// Makes real HTTP requests to a running server (remote access mode).

export class HttpClient implements ServerClient {
  constructor(private baseUrl: string) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, init);
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async void_(path: string, init?: RequestInit): Promise<void> {
    const res = await this.request(path, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
  }

  // All methods delegate to the same pattern as DirectClient.
  // The only difference is the base URL.

  async createSession(workspaceDir: string) {
    return this.json<{ id: string }>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceDir }),
    });
  }

  async listSessions(workspaceDir: string) {
    return this.json<Array<{ id: string; startedAt: string; lastActivity: string; preview: string; turnCount: number }>>(
      `/api/sessions?workspaceDir=${encodeURIComponent(workspaceDir)}`
    );
  }

  async getSessionHistory(sessionId: string) {
    return this.json<{ messages: Array<{ role: string; text: string }>; llmHistory: LLMMessage[] }>(
      `/api/sessions/${sessionId}/history`
    );
  }

  async deleteSession(sessionId: string) {
    await this.void_(`/api/sessions/${sessionId}`, { method: "DELETE" });
  }

  async *sendMessage(
    sessionId: string,
    message: string,
    options?: SendMessageOptions
  ): AsyncIterable<ServerEvent> {
    const res = await this.request(`/api/sessions/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, ...options }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }

    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data) as ServerEvent;
          } catch {
            // Skip malformed events
          }
        }
      }
    }
  }

  async abort(sessionId: string) {
    await this.void_(`/api/sessions/${sessionId}/abort`, { method: "POST" });
  }

  async compact(sessionId: string) {
    await this.void_(`/api/sessions/${sessionId}/compact`, { method: "POST" });
  }

  async answerQuestion(sessionId: string, questionId: string, answer: AskUserAnswer) {
    await this.void_(`/api/questions/${sessionId}/${questionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answer),
    });
  }

  async getPendingUpdates(sessionId: string) {
    return this.json<ProposedUpdate[]>(`/api/updates/${sessionId}`);
  }

  async acceptUpdate(sessionId: string, updateId: string) {
    await this.void_(`/api/updates/${sessionId}/${updateId}/accept`, { method: "POST" });
  }

  async rejectUpdate(sessionId: string, updateId: string) {
    await this.void_(`/api/updates/${sessionId}/${updateId}/reject`, { method: "POST" });
  }

  async getSnapshots(sessionId: string) {
    return this.json<Array<{ turnIndex: number; patch: SnapshotPatch; timestamp: string }>>(
      `/api/snapshots/${sessionId}`
    );
  }

  async revert(sessionId: string, afterTurn: number) {
    return this.json<{ revertedTurns: number[]; filesRestored: string[] }>(
      `/api/snapshots/${sessionId}/revert`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterTurn }),
      }
    );
  }

  async unrevert(sessionId: string) {
    await this.void_(`/api/snapshots/${sessionId}/unrevert`, { method: "POST" });
  }

  async initWorkspace(workspaceDir: string) {
    await this.void_("/api/workspace/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceDir }),
    });
  }

  async scanWorkspace(workspaceDir: string) {
    return this.json<Array<{ key: string; label: string }>>(
      `/api/workspace/scan?workspaceDir=${encodeURIComponent(workspaceDir)}`
    );
  }

  async getAuthStatus() {
    return this.json<{ status: "missing" | "connected"; provider?: string }>("/api/auth/status");
  }

  async login() {
    await this.void_("/api/auth/login", { method: "POST" });
  }

  async loginGemini() {
    await this.void_("/api/auth/login-gemini", { method: "POST" });
  }

  async importCodex() {
    await this.void_("/api/auth/import-codex", { method: "POST" });
  }

  async logout() {
    await this.void_("/api/auth/logout", { method: "POST" });
  }

  async getConfig() {
    return this.json<Record<string, unknown>>("/api/config");
  }

  async updateConfig(updates: Record<string, unknown>) {
    await this.void_("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }

  async getModels() {
    return this.json<Array<{ id: string; name: string; contextWindow: number }>>("/api/config/models");
  }

  async listSkills() {
    return this.json<Array<{ name: string; description: string }>>("/api/skills");
  }

  async listMemories() {
    return this.json<Array<{ id: string; content: string; category: string; scope: string }>>("/api/memory");
  }

  async deleteMemory(id: string) {
    await this.void_(`/api/memory/${id}`, { method: "DELETE" });
  }

  async clearMemories() {
    await this.void_("/api/memory", { method: "DELETE" });
  }

  async getOntologyStatus() {
    return this.json<{ noteCount: number; edgeCount: number }>("/api/ontology/status");
  }
}
