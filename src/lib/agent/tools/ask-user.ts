import type { AskUserQuestion, AskUserAnswer } from "../state";

export interface AskUserPendingQuestion {
  question: AskUserQuestion;
  resolve: (answer: AskUserAnswer) => void;
}

/**
 * Queue of pending questions the agent has asked.
 * The TUI polls this and renders them for the user.
 */
let pendingQuestions: AskUserPendingQuestion[] = [];

export function getPendingQuestion(): AskUserPendingQuestion | null {
  return pendingQuestions[0] ?? null;
}

export function clearPendingQuestion(): void {
  pendingQuestions.shift();
}

export function resetPendingQuestions(): void {
  pendingQuestions = [];
}

/**
 * Execute the ask_user tool: creates a question, waits for the TUI to answer it.
 * Returns the user's answer as a string for the LLM.
 */
export async function executeAskUser(
  args: {
    question: string;
    options?: Array<{ label: string; description: string }>;
    allow_custom?: boolean;
  },
  signal?: AbortSignal
): Promise<string> {
  const questionId = crypto.randomUUID();

  const question: AskUserQuestion = {
    id: questionId,
    question: args.question,
    options: (args.options ?? []).map((o) => ({
      label: o.label,
      description: o.description,
    })),
    allowCustom: args.allow_custom ?? true,
  };

  const answerPromise = new Promise<AskUserAnswer>((resolve, reject) => {
    pendingQuestions.push({ question, resolve });

    // Abort handling
    if (signal) {
      const onAbort = () => {
        pendingQuestions = pendingQuestions.filter((q) => q.question.id !== questionId);
        reject(new Error("Question cancelled — user interrupted."));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  const answer = await answerPromise;

  if (answer.isCustom) {
    return `User answered: "${answer.answer}"`;
  }
  return `User selected: "${answer.answer}"`;
}
