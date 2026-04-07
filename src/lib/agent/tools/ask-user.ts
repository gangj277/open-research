import type { AskUserQuestion, AskUserAnswer } from "../state";

export interface AskUserPendingQuestion {
  question: AskUserQuestion;
  resolve: (answer: AskUserAnswer) => void;
}

/**
 * Queue of pending questions the agent has asked.
 * The TUI polls this and renders them one at a time.
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

// ── Types for tool args ────────────────────────────────────────────────────

interface QuestionItem {
  question: string;
  options?: Array<{ label: string; description: string }>;
}

interface AskUserArgs {
  // New: batch of questions
  questions?: QuestionItem[];
  // Legacy: single question (backward compat)
  question?: string;
  options?: Array<{ label: string; description: string }>;
  allow_custom?: boolean;
}

// ── Normalize args ─────────────────────────────────────────────────────────

function normalizeQuestions(args: AskUserArgs): QuestionItem[] {
  // New format: questions array
  if (args.questions && args.questions.length > 0) {
    return args.questions.slice(0, 4); // max 4
  }
  // Legacy format: single question string
  if (args.question) {
    return [{ question: args.question, options: args.options }];
  }
  return [];
}

// ── Execute ────────────────────────────────────────────────────────────────

/**
 * Execute the ask_user tool: queues one or more questions and waits for all answers.
 * Returns all answers as a formatted string for the LLM.
 */
export async function executeAskUser(
  args: AskUserArgs,
  signal?: AbortSignal
): Promise<string> {
  const items = normalizeQuestions(args);
  if (items.length === 0) {
    return "Error: no question provided.";
  }

  const answers: string[] = [];

  for (const item of items) {
    const questionId = crypto.randomUUID();

    const question: AskUserQuestion = {
      id: questionId,
      question: item.question,
      options: (item.options ?? []).map((o) => ({
        label: o.label,
        description: o.description,
      })),
      allowCustom: true,
    };

    const answer = await new Promise<AskUserAnswer>((resolve, reject) => {
      pendingQuestions.push({ question, resolve });

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

    const prefix = items.length > 1
      ? `Q${answers.length + 1}: "${item.question}" → `
      : "";
    answers.push(
      answer.isCustom
        ? `${prefix}User answered: "${answer.answer}"`
        : `${prefix}User selected: "${answer.answer}"`
    );
  }

  return answers.join("\n");
}
