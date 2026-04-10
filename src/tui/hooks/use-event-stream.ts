import { useCallback, useRef } from "react";
import type { ServerEvent } from "@/server/types";
import type { ToolActivity } from "@/lib/agent/runtime";
import type { SubAgentProgress } from "@/lib/agent/subagent";
import type { ProposedUpdate, AskUserQuestion } from "@/lib/agent/state";
import type { SessionTokenUsage } from "@/lib/agent/context-manager";

export interface EventStreamCallbacks {
  onTextDelta?: (content: string) => void;
  onToolActivity?: (activity: ToolActivity) => void;
  onSubAgentProgress?: (progress: SubAgentProgress) => void;
  onProposedUpdate?: (update: ProposedUpdate) => void;
  onAskUser?: (question: AskUserQuestion) => void;
  onQuestionResolved?: (questionId: string) => void;
  onTokenUpdate?: (usage: SessionTokenUsage) => void;
  onMemoryExtracted?: (memories: string[]) => void;
  onCompaction?: () => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/**
 * Dispatches a ServerEvent to the appropriate callback.
 * Used by the TUI to process events from the server (via DirectClient or HttpClient).
 */
export function dispatchEvent(event: ServerEvent, callbacks: EventStreamCallbacks): void {
  switch (event.type) {
    case "text_delta":
      callbacks.onTextDelta?.(event.content);
      break;
    case "tool_activity":
      callbacks.onToolActivity?.(event.activity);
      break;
    case "subagent_progress":
      callbacks.onSubAgentProgress?.(event.progress);
      break;
    case "proposed_update":
      callbacks.onProposedUpdate?.(event.update);
      break;
    case "ask_user":
      callbacks.onAskUser?.(event.question);
      break;
    case "question_resolved":
      callbacks.onQuestionResolved?.(event.questionId);
      break;
    case "token_update":
      callbacks.onTokenUpdate?.(event.usage);
      break;
    case "memory_extracted":
      callbacks.onMemoryExtracted?.(event.memories);
      break;
    case "context_compacted":
      callbacks.onCompaction?.();
      break;
    case "error":
      callbacks.onError?.(event.message);
      break;
    case "done":
      callbacks.onDone?.();
      break;
  }
}

/**
 * React hook that provides a stable dispatch function for processing event streams.
 * Wrap callbacks in useRef to avoid re-creating the dispatch on every render.
 */
export function useEventDispatch(callbacks: EventStreamCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const dispatch = useCallback((event: ServerEvent) => {
    dispatchEvent(event, callbacksRef.current);
  }, []);

  return dispatch;
}
