import type { LLMProvider } from "@/lib/llm/provider";
import type { OntologyManagerInput } from "./types";
import { runOntologyManager } from "./manager";

// ── Serial Async Queue ─────────────────────────────────────────────────────
//
// Each ontology manager invocation awaits the previous one before starting.
// Promise chaining in JS — no locks needed (single-threaded event loop).
//
// Turn 1 completes → enqueue(turn1) → Manager 1 starts immediately
// Turn 2 completes → enqueue(turn2) → Manager 2 QUEUED behind Manager 1
// Manager 1 finishes → ontology.json updated → Manager 2 starts (sees Turn 1's writes)

let pendingWrite: Promise<void> = Promise.resolve();

export function enqueueOntologyManager(input: OntologyManagerInput & {
  provider: LLMProvider;
  workspaceDir: string;
  onOntologyUpdated?: () => void;
}): void {
  pendingWrite = pendingWrite
    .then(() => runOntologyManager({
      userMessage: input.userMessage,
      agentResponse: input.agentResponse,
      toolOutputs: input.toolOutputs,
      provider: input.provider,
      workspaceDir: input.workspaceDir,
    }))
    .then(() => input.onOntologyUpdated?.())
    .catch((err) => {
      // Best-effort — don't block the queue on failure
      if (process.env.DEBUG) {
        process.stderr.write(`[ontology-manager] Error: ${err?.message ?? err}\n`);
      }
    });
}
