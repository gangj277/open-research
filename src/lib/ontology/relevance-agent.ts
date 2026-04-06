import type { LLMProvider } from "@/lib/llm/provider";
import type { Ontology, Note } from "./types";

// ── Pre-filter ─────────────────────────────────────────────────────────────

export function shouldRunRelevanceAgent(
  message: string,
  ontology: Ontology
): boolean {
  if (ontology.notes.length === 0) return false;
  if (message.startsWith("/")) return false;
  if (message.length < 15) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|yes|no|sure|got it)\b/i.test(message)) return false;
  return true;
}

// ── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You select which notes from a research ontology are relevant to the user's current message.

Return a JSON array of note IDs. Nothing else — no markdown, no explanation, no text outside the array.

# Selection criteria

Include a note if ANY of these apply:
- It is about the same topic or concept (even using different terminology)
- It provides evidence for or against what the user is discussing
- It is a source, finding, or method referenced directly or indirectly
- It contains a contradiction or open question the user should be aware of

Prioritize: claims with contradictions > claims the user is building on > directly relevant findings > contextual sources > tangential notes.

# Output

- Return 5-15 IDs (fewer if few are relevant, more if the topic is well-covered)
- Return [] if nothing is relevant
- Output ONLY a JSON array: ["id1", "id2", ...]`;

// ── Build compact note list ────────────────────────────────────────────────

function buildNoteList(notes: Note[]): string {
  return notes
    .map((n) => `[${n.id}] "${n.content}" (${n.kind})`)
    .join("\n");
}

// ── Run Relevance Agent ────────────────────────────────────────────────────

export async function runRelevanceAgent(input: {
  userMessage: string;
  ontology: Ontology;
  provider: LLMProvider;
}): Promise<string[]> {
  const { userMessage, ontology, provider } = input;

  // Pre-filter check
  if (!shouldRunRelevanceAgent(userMessage, ontology)) {
    return [];
  }

  // If ontology is large, pre-filter by recency to ~100 candidates
  let candidates = ontology.notes;
  if (candidates.length > 100) {
    candidates = [...candidates]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100);
  }

  const noteList = buildNoteList(candidates);

  try {
    const response = await provider.callLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `## User's message\n${userMessage}\n\n## Notes in ontology\n${noteList}`,
        },
      ],
      model: "gpt-5.4-mini",
      maxTokens: 500,
      temperature: 0,
    });

    // Parse JSON array from response
    const raw = response.content.trim();
    const jsonStr = raw.startsWith("[") ? raw : raw.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) return [];

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    // Validate IDs against actual notes
    const noteIds = new Set(ontology.notes.map((n) => n.id));
    return parsed
      .filter((id: unknown): id is string => typeof id === "string" && noteIds.has(id))
      .slice(0, 15);
  } catch {
    return []; // Best-effort — scaffolding without relevance is fine
  }
}
