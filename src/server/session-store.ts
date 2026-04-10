import { randomUUID } from "node:crypto";
import { SessionBus } from "./bus";
import { createDeferred, type Deferred } from "./deferred";
import type { QuestionBridge, ServerEvent } from "./types";
import type {
  AskUserQuestion,
  AskUserAnswer,
  ProposedUpdate,
} from "@/lib/agent/state";
import type { LLMMessage } from "@/lib/llm/types";
import type { SessionTokenUsage } from "@/lib/agent/context-manager";
import type { RuntimeSkill } from "@/lib/skills/runtime";
import type { TurnSnapshot } from "@/lib/snapshot/types";

// ── Session State ──────────────────────────────────────────────────────────

export interface Session {
  id: string;
  workspaceDir: string;
  bus: SessionBus;
  history: LLMMessage[];
  activeSkills: RuntimeSkill[];
  tokenUsage: SessionTokenUsage | null;
  pendingUpdates: ProposedUpdate[];
  pendingQuestions: Map<string, Deferred<AskUserAnswer>>;
  abortController: AbortController | null;
  turnSnapshots: TurnSnapshot[];
  createdAt: string;
}

// ── Session Manager ────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, Session>();

  create(workspaceDir: string): Session {
    const session: Session = {
      id: randomUUID(),
      workspaceDir,
      bus: new SessionBus(),
      history: [],
      activeSkills: [],
      tokenUsage: null,
      pendingUpdates: [],
      pendingQuestions: new Map(),
      abortController: null,
      turnSnapshots: [],
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.bus.removeAllListeners();
      session.abortController?.abort();
      // Reject any pending questions
      for (const deferred of session.pendingQuestions.values()) {
        deferred.reject(new Error("Session deleted"));
      }
    }
    return this.sessions.delete(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  /** Create a QuestionBridge for a session that uses Deferred + bus */
  createQuestionBridge(session: Session): QuestionBridge {
    return {
      async createQuestion(question: AskUserQuestion): Promise<AskUserAnswer> {
        const deferred = createDeferred<AskUserAnswer>();
        session.pendingQuestions.set(question.id, deferred);
        session.bus.emit({ type: "ask_user", question });

        try {
          const answer = await deferred.promise;
          return answer;
        } finally {
          session.pendingQuestions.delete(question.id);
          session.bus.emit({ type: "question_resolved", questionId: question.id });
        }
      },
    };
  }

  /** Create an EventSink that forwards to the session bus */
  createEventSink(session: Session): (event: ServerEvent) => void {
    return (event: ServerEvent) => {
      session.bus.emit(event);
    };
  }
}
