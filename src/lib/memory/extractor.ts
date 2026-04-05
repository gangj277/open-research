import type { LLMProvider } from "@/lib/llm/provider";
import type { PathOptions } from "@/lib/fs/paths";
import { addMemory, loadMemories, type Memory } from "./store";

// ── Memory Extraction Prompt ────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a memory extraction system. Your job is to identify facts worth remembering about the user from a conversation exchange.

Focus on:
- Who they are (role, field, institution, expertise level)
- What they're working on (current research projects, topics, deadlines)
- How they prefer to work (preferred tools, languages, writing style, methodologies)
- Methodological preferences (statistical approaches, theoretical frameworks, citation style)
- Important context (collaborators, advisors, publication targets, funding constraints)

Rules:
- Only extract facts that would be useful in FUTURE conversations
- Be specific and concise — each memory should be one clear fact
- Do NOT extract task-specific details that only matter for the current conversation
- Do NOT extract obvious things ("user asked about papers" is not useful)
- If there is nothing meaningful to remember, return an empty array
- Maximum 3 new memories per exchange

Existing memories (do not duplicate these):
{EXISTING_MEMORIES}

Respond with a JSON array of objects, each with "content" (string) and "category" (one of: "user", "preference", "project", "methodology", "context"). If nothing worth remembering, respond with [].

Example response:
[{"content": "PhD student in computational neuroscience at MIT", "category": "user"}, {"content": "Prefers Python with statsmodels for statistical analysis over R", "category": "preference"}]`;

// ── Types ───────────────────────────────────────────────────────────────────

interface ExtractedMemory {
  content: string;
  category: "user" | "preference" | "project" | "methodology" | "context";
}

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * Analyze a conversation exchange and extract memories worth storing.
 * Runs as a lightweight background LLM call — does not block the main agent loop.
 */
export async function extractMemories(input: {
  userMessage: string;
  agentResponse: string;
  provider: LLMProvider;
  model?: string;
  homeDir?: string;
}): Promise<ExtractedMemory[]> {
  const existing = await loadMemories({ homeDir: input.homeDir });

  // Don't extract if the message is just a slash command or very short
  if (input.userMessage.startsWith("/") || input.userMessage.length < 20) {
    return [];
  }

  const existingList = existing.length > 0
    ? existing.map((m) => `- [${m.category}] ${m.content}`).join("\n")
    : "(none)";

  const prompt = EXTRACTION_PROMPT.replace("{EXISTING_MEMORIES}", existingList);

  const conversationSnippet = [
    `User: ${input.userMessage.slice(0, 2000)}`,
    `Agent: ${input.agentResponse.slice(0, 2000)}`,
  ].join("\n\n");

  try {
    const response = await input.provider.callLLM({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: conversationSnippet },
      ],
      model: input.model ?? "gpt-4o-mini",
      maxTokens: 500,
      temperature: 0,
    });

    // Parse the JSON response
    const raw = response.content.trim();
    // Handle markdown code blocks
    const jsonStr = raw.startsWith("```")
      ? raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
      : raw;

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    const valid: ExtractedMemory[] = [];
    for (const item of parsed) {
      if (
        typeof item.content === "string" &&
        item.content.length > 5 &&
        ["user", "preference", "project", "methodology", "context"].includes(item.category)
      ) {
        valid.push({
          content: item.content,
          category: item.category,
        });
      }
    }

    return valid.slice(0, 3);
  } catch {
    // Extraction is best-effort — never fail the main flow
    return [];
  }
}

/**
 * Extract and store memories from a conversation exchange.
 * Runs in the background — fire and forget.
 */
export async function extractAndStoreMemories(input: {
  userMessage: string;
  agentResponse: string;
  provider: LLMProvider;
  model?: string;
  homeDir?: string;
}): Promise<Memory[]> {
  const extracted = await extractMemories(input);
  const stored: Memory[] = [];

  for (const mem of extracted) {
    const saved = await addMemory(mem, { homeDir: input.homeDir });
    stored.push(saved);
  }

  return stored;
}
