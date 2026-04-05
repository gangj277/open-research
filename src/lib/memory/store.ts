import fs from "node:fs/promises";
import path from "node:path";
import { getOpenResearchRoot, type PathOptions } from "@/lib/fs/paths";

// ── Memory Types ────────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  /** What the agent learned */
  content: string;
  /** Category for organization */
  category: "user" | "preference" | "project" | "methodology" | "context";
  /** When this memory was created */
  createdAt: string;
  /** When this memory was last confirmed/reinforced */
  lastRelevantAt: string;
  /** How many times this memory has been relevant */
  relevanceCount: number;
}

export interface MemoryStore {
  version: 1;
  memories: Memory[];
}

// ── File Operations ─────────────────────────────────────────────────────────

function getMemoryFile(options?: PathOptions): string {
  return path.join(getOpenResearchRoot(options), "memory.json");
}

export async function loadMemories(options?: PathOptions): Promise<Memory[]> {
  const file = getMemoryFile(options);
  try {
    const raw = await fs.readFile(file, "utf8");
    const store: MemoryStore = JSON.parse(raw);
    return store.memories ?? [];
  } catch {
    return [];
  }
}

async function saveMemories(memories: Memory[], options?: PathOptions): Promise<void> {
  const file = getMemoryFile(options);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const store: MemoryStore = { version: 1, memories };
  await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

// ── Memory Operations ───────────────────────────────────────────────────────

const MAX_MEMORIES = 100;

export async function addMemory(
  memory: Omit<Memory, "id" | "createdAt" | "lastRelevantAt" | "relevanceCount">,
  options?: PathOptions
): Promise<Memory> {
  const memories = await loadMemories(options);

  // Check for near-duplicate — if a memory with very similar content exists, reinforce it instead
  const existing = memories.find((m) => {
    const a = m.content.toLowerCase().replace(/\s+/g, " ");
    const b = memory.content.toLowerCase().replace(/\s+/g, " ");
    // Simple overlap check — if >70% of words match, it's a duplicate
    const wordsA = new Set(a.split(" "));
    const wordsB = new Set(b.split(" "));
    const intersection = [...wordsA].filter((w) => wordsB.has(w));
    const similarity = intersection.length / Math.max(wordsA.size, wordsB.size);
    return similarity > 0.7;
  });

  if (existing) {
    existing.lastRelevantAt = new Date().toISOString();
    existing.relevanceCount++;
    // Update content if new version is longer (more detailed)
    if (memory.content.length > existing.content.length) {
      existing.content = memory.content;
    }
    await saveMemories(memories, options);
    return existing;
  }

  const newMemory: Memory = {
    id: crypto.randomUUID(),
    content: memory.content,
    category: memory.category,
    createdAt: new Date().toISOString(),
    lastRelevantAt: new Date().toISOString(),
    relevanceCount: 1,
  };

  memories.push(newMemory);

  // If over limit, drop the least-relevant memories
  if (memories.length > MAX_MEMORIES) {
    memories.sort((a, b) => {
      // Score: recency + frequency
      const aScore = new Date(a.lastRelevantAt).getTime() + a.relevanceCount * 86400000;
      const bScore = new Date(b.lastRelevantAt).getTime() + b.relevanceCount * 86400000;
      return bScore - aScore;
    });
    memories.length = MAX_MEMORIES;
  }

  await saveMemories(memories, options);
  return newMemory;
}

export async function deleteMemory(id: string, options?: PathOptions): Promise<boolean> {
  const memories = await loadMemories(options);
  const idx = memories.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  memories.splice(idx, 1);
  await saveMemories(memories, options);
  return true;
}

export async function clearMemories(options?: PathOptions): Promise<void> {
  await saveMemories([], options);
}

// ── Memory Formatting for System Prompt ─────────────────────────────────────

export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const grouped: Record<string, Memory[]> = {};
  for (const m of memories) {
    (grouped[m.category] ??= []).push(m);
  }

  const sections: string[] = ["## What I Remember About You"];

  const categoryLabels: Record<string, string> = {
    user: "About you",
    preference: "Your preferences",
    project: "Your projects",
    methodology: "Methodology preferences",
    context: "Context",
  };

  for (const [cat, mems] of Object.entries(grouped)) {
    sections.push(`**${categoryLabels[cat] ?? cat}:**`);
    for (const m of mems) {
      sections.push(`- ${m.content}`);
    }
  }

  return sections.join("\n");
}
