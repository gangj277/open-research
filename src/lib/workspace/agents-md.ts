import fs from "node:fs/promises";
import path from "node:path";
import type { LLMProvider } from "@/lib/llm/provider";

const AGENTS_MD_FILENAME = "AGENTS.md";

/**
 * Read the AGENTS.md file from a workspace root.
 * Returns empty string if it doesn't exist.
 */
export async function readAgentsMd(workspaceDir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(workspaceDir, AGENTS_MD_FILENAME), "utf8");
  } catch {
    return "";
  }
}

/**
 * Write the AGENTS.md file to a workspace root.
 */
export async function writeAgentsMd(workspaceDir: string, content: string): Promise<void> {
  await fs.writeFile(path.join(workspaceDir, AGENTS_MD_FILENAME), content, "utf8");
}

// ── Background Updater ──────────────────────────────────────────────────────

const UPDATE_SYSTEM_PROMPT = `You maintain an AGENTS.md file for a research workspace. This file gives future agent sessions instant context about the project — what it's about, what's been done, key files, and current direction.

You will receive:
1. The current AGENTS.md content (may be empty on first run)
2. A summary of what just happened in the latest conversation turn

Your job: decide if AGENTS.md should be updated based on the new information. If yes, output the FULL updated AGENTS.md content. If nothing meaningful changed, output exactly "NO_UPDATE".

Rules:
- Keep it concise — under 2000 characters. This gets injected into every system prompt.
- Structure: Project overview → Key files → Current state → Research direction
- Only include information that helps a NEW agent session pick up where this one left off
- Don't include conversation-specific details — only durable project knowledge
- Update incrementally — preserve existing content, add/modify what changed
- Use markdown with ## headings`;

const UPDATE_USER_TEMPLATE = `Current AGENTS.md:
---
{CURRENT_CONTENT}
---

Latest turn summary:
User asked: {USER_MESSAGE}
Agent did: {AGENT_SUMMARY}

Should AGENTS.md be updated? If yes, output the full updated content. If no meaningful project-level changes, output exactly "NO_UPDATE".`;

/**
 * Analyze a conversation turn and update AGENTS.md if meaningful
 * project-level information was learned. Runs in background (fire-and-forget).
 */
export async function maybeUpdateAgentsMd(input: {
  workspaceDir: string;
  userMessage: string;
  agentResponse: string;
  provider: LLMProvider;
  model?: string;
}): Promise<boolean> {
  // Skip short/trivial interactions
  if (input.userMessage.length < 15) return false;
  if (input.userMessage.startsWith("/")) return false;

  const currentContent = await readAgentsMd(input.workspaceDir);

  const userPrompt = UPDATE_USER_TEMPLATE
    .replace("{CURRENT_CONTENT}", currentContent || "(empty — first time)")
    .replace("{USER_MESSAGE}", input.userMessage.slice(0, 500))
    .replace("{AGENT_SUMMARY}", input.agentResponse.slice(0, 1500));

  try {
    const response = await input.provider.callLLM({
      messages: [
        { role: "system", content: UPDATE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: input.model ?? "gpt-5.4-mini",
      maxTokens: 2048,
      temperature: 0,
    });

    const result = response.content.trim();
    if (result === "NO_UPDATE" || result.length < 20) {
      return false;
    }

    // Strip markdown code fences if the model wrapped it
    const cleaned = result
      .replace(/^```(?:markdown)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    await writeAgentsMd(input.workspaceDir, cleaned);
    return true;
  } catch {
    return false; // Best-effort, never fail the main flow
  }
}
