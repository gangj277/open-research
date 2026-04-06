import type { LLMProvider } from "@/lib/llm/provider";
import type { PathOptions } from "@/lib/fs/paths";
import { addMemory, loadAllMemories, type Memory } from "./store";

// ── Memory Extraction Prompt ────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a memory management system. You decide what to remember about the user across sessions.

You will receive:
1. The current conversation exchange
2. ALL existing memories (both global and project-level)

Your job: decide if any NEW memories should be created OR if any existing memories need updating.

CRITICAL RULES:
- Do NOT create a memory if an existing memory already covers the same fact
- If a fact has CHANGED (e.g., user switched from Python to R), output an UPDATE to the existing memory instead of creating a new one
- Only create memories for facts useful in FUTURE sessions, not task-specific details
- Maximum 3 actions per exchange
- If nothing meaningful to remember, return an empty array

Categories:
- "user" — identity, role, field, institution (→ stored globally)
- "preference" — tools, style, methodology preferences (→ stored globally)
- "project" — current research topics, findings, hypotheses (→ stored per-project)
- "methodology" — statistical approaches, frameworks (→ stored globally)
- "context" — deadlines, collaborators, constraints (→ stored per-project)

Existing memories:
{EXISTING_MEMORIES}

Respond with a JSON array. Each item has:
- "action": "create" or "update"
- "content": the memory text (for create: new content; for update: the updated content)
- "category": one of the categories above
- "updateId": (only for "update") the ID of the existing memory to update

If nothing to do, respond with [].

Example:
[{"action": "create", "content": "PhD student in neuroscience at MIT", "category": "user"}]
[{"action": "update", "updateId": "abc123", "content": "Now using R instead of Python for analysis", "category": "preference"}]`;

// ── Types ───────────────────────────────────────────────────────────────────

interface ExtractedAction {
  action: "create" | "update";
  content: string;
  category: "user" | "preference" | "project" | "methodology" | "context";
  updateId?: string;
}

// ── Extraction ──────────────────────────────────────────────────────────────

export async function extractMemories(input: {
  userMessage: string;
  agentResponse: string;
  provider: LLMProvider;
  model?: string;
  homeDir?: string;
  workspaceDir?: string;
}): Promise<ExtractedAction[]> {
  // Load both global and project memories
  const existing = await loadAllMemories({
    homeDir: input.homeDir,
    workspaceDir: input.workspaceDir,
  });

  if (input.userMessage.startsWith("/") || input.userMessage.length < 20) {
    return [];
  }

  const existingList = existing.length > 0
    ? existing.map((m) => `- [${m.scope}/${m.category}] (id: ${m.id.slice(0, 8)}) ${m.content}`).join("\n")
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
      model: input.model ?? "gpt-5.4-mini",
      maxTokens: 500,
      temperature: 0,
    });

    const raw = response.content.trim();
    const jsonStr = raw.startsWith("```")
      ? raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
      : raw;

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    const valid: ExtractedAction[] = [];
    for (const item of parsed) {
      if (
        typeof item.content === "string" &&
        item.content.length > 5 &&
        ["user", "preference", "project", "methodology", "context"].includes(item.category) &&
        ["create", "update"].includes(item.action)
      ) {
        valid.push({
          action: item.action,
          content: item.content,
          category: item.category,
          updateId: typeof item.updateId === "string" ? item.updateId : undefined,
        });
      }
    }

    return valid.slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * Extract and store memories from a conversation exchange.
 * Handles both creates and updates.
 */
export async function extractAndStoreMemories(input: {
  userMessage: string;
  agentResponse: string;
  provider: LLMProvider;
  model?: string;
  homeDir?: string;
  workspaceDir?: string;
}): Promise<Memory[]> {
  const actions = await extractMemories(input);
  const results: Memory[] = [];

  // Load existing for update lookups
  const existing = await loadAllMemories({
    homeDir: input.homeDir,
    workspaceDir: input.workspaceDir,
  });

  for (const action of actions) {
    if (action.action === "update" && action.updateId) {
      // Find and update the existing memory
      const target = existing.find((m) => m.id.startsWith(action.updateId!));
      if (target) {
        target.content = action.content;
        target.lastRelevantAt = new Date().toISOString();
        target.relevanceCount++;
        // Re-save by adding (addMemory handles dedup and will update in place)
        const saved = await addMemory(
          { content: action.content, category: action.category, scope: target.scope },
          { homeDir: input.homeDir, workspaceDir: input.workspaceDir }
        );
        results.push(saved);
      }
    } else {
      // Create new
      const scope = (action.category === "project" || action.category === "context") ? "project" : "global";
      const saved = await addMemory(
        { content: action.content, category: action.category, scope },
        { homeDir: input.homeDir, workspaceDir: input.workspaceDir }
      );
      results.push(saved);
    }
  }

  return results;
}
