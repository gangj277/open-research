import fs from "node:fs/promises";
import path from "node:path";
import { getOpenResearchRoot, type PathOptions } from "@/lib/fs/paths";

// ── Memory Types ────────────────────────────────────────────────────────────

export type MemoryScope = "global" | "project";

export interface Memory {
  id: string;
  content: string;
  category: "user" | "preference" | "methodology" | "context";
  scope: MemoryScope;
  createdAt: string;
  lastRelevantAt: string;
  relevanceCount: number;
}

export interface MemoryStore {
  version: 2;
  memories: Memory[];
}

// ── File Operations ─────────────────────────────────────────────────────────

function getGlobalMemoryFile(options?: PathOptions): string {
  return path.join(getOpenResearchRoot(options), "memory.json");
}

function getProjectMemoryFile(workspaceDir: string): string {
  return path.join(workspaceDir, ".open-research", "memory.json");
}

async function loadMemoryFile(filePath: string): Promise<Memory[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const store = JSON.parse(raw) as MemoryStore;
    return store.memories ?? [];
  } catch {
    return [];
  }
}

async function saveMemoryFile(filePath: string, memories: Memory[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const store: MemoryStore = { version: 2, memories };
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
}

// ── Load Memories ───────────────────────────────────────────────────────────

export async function loadGlobalMemories(options?: PathOptions): Promise<Memory[]> {
  const mems = await loadMemoryFile(getGlobalMemoryFile(options));
  return mems.map((m) => ({ ...m, scope: "global" as const }));
}

export async function loadProjectMemories(workspaceDir: string): Promise<Memory[]> {
  const mems = await loadMemoryFile(getProjectMemoryFile(workspaceDir));
  return mems.map((m) => ({ ...m, scope: "project" as const }));
}

/** Load both global + project memories */
export async function loadAllMemories(options?: PathOptions & { workspaceDir?: string }): Promise<Memory[]> {
  const global = await loadGlobalMemories(options);
  const project = options?.workspaceDir
    ? await loadProjectMemories(options.workspaceDir)
    : [];
  return [...global, ...project];
}

// Backward compat
export async function loadMemories(options?: PathOptions): Promise<Memory[]> {
  return loadGlobalMemories(options);
}

// ── Add Memory ──────────────────────────────────────────────────────────────

const MAX_MEMORIES_PER_STORE = 100;

function findDuplicate(memories: Memory[], content: string): Memory | undefined {
  const b = content.toLowerCase().replace(/\s+/g, " ");
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  return memories.find((m) => {
    const a = m.content.toLowerCase().replace(/\s+/g, " ");
    const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
    const intersection = [...wordsA].filter((w) => wordsB.has(w));
    return intersection.length / Math.max(wordsA.size, wordsB.size) > 0.7;
  });
}

function evictIfNeeded(memories: Memory[]): void {
  if (memories.length <= MAX_MEMORIES_PER_STORE) return;
  memories.sort((a, b) => {
    const aScore = new Date(a.lastRelevantAt).getTime() + a.relevanceCount * 86400000;
    const bScore = new Date(b.lastRelevantAt).getTime() + b.relevanceCount * 86400000;
    return bScore - aScore;
  });
  memories.length = MAX_MEMORIES_PER_STORE;
}

export async function addMemory(
  memory: Omit<Memory, "id" | "createdAt" | "lastRelevantAt" | "relevanceCount" | "scope"> & { scope?: MemoryScope },
  options?: PathOptions & { workspaceDir?: string }
): Promise<Memory> {
  const scope = memory.scope ?? (memory.category === "context" ? "project" : "global");
  const filePath = scope === "project" && options?.workspaceDir
    ? getProjectMemoryFile(options.workspaceDir)
    : getGlobalMemoryFile(options);

  const memories = await loadMemoryFile(filePath);

  // Dedup check
  const existing = findDuplicate(memories, memory.content);
  if (existing) {
    existing.lastRelevantAt = new Date().toISOString();
    existing.relevanceCount++;
    if (memory.content.length > existing.content.length) {
      existing.content = memory.content;
    }
    await saveMemoryFile(filePath, memories);
    return { ...existing, scope };
  }

  const newMemory: Memory = {
    id: crypto.randomUUID(),
    content: memory.content,
    category: memory.category,
    scope,
    createdAt: new Date().toISOString(),
    lastRelevantAt: new Date().toISOString(),
    relevanceCount: 1,
  };

  memories.push(newMemory);
  evictIfNeeded(memories);
  await saveMemoryFile(filePath, memories);
  return newMemory;
}

// ── Delete / Clear ──────────────────────────────────────────────────────────

export async function deleteMemory(
  id: string,
  options?: PathOptions & { workspaceDir?: string }
): Promise<boolean> {
  // Try global first
  const globalFile = getGlobalMemoryFile(options);
  const global = await loadMemoryFile(globalFile);
  const gIdx = global.findIndex((m) => m.id === id);
  if (gIdx !== -1) {
    global.splice(gIdx, 1);
    await saveMemoryFile(globalFile, global);
    return true;
  }
  // Try project
  if (options?.workspaceDir) {
    const projectFile = getProjectMemoryFile(options.workspaceDir);
    const project = await loadMemoryFile(projectFile);
    const pIdx = project.findIndex((m) => m.id === id);
    if (pIdx !== -1) {
      project.splice(pIdx, 1);
      await saveMemoryFile(projectFile, project);
      return true;
    }
  }
  return false;
}

export async function clearMemories(options?: PathOptions & { workspaceDir?: string; scope?: MemoryScope }): Promise<void> {
  if (!options?.scope || options.scope === "global") {
    await saveMemoryFile(getGlobalMemoryFile(options), []);
  }
  if (options?.workspaceDir && (!options?.scope || options.scope === "project")) {
    await saveMemoryFile(getProjectMemoryFile(options.workspaceDir), []);
  }
}

// ── Relevance Scoring & Selective Retrieval ─────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "about",
  "and", "but", "or", "not", "no", "if", "then", "than", "so", "that",
  "this", "it", "its", "i", "me", "my", "we", "our", "you", "your",
  "what", "which", "who", "how", "when", "where", "why",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreRelevance(memory: Memory, queryTokens: Set<string>): number {
  const memTokens = tokenize(memory.content);
  if (memTokens.length === 0) return 0;

  // Word overlap score
  let matches = 0;
  for (const token of memTokens) {
    if (queryTokens.has(token)) matches++;
  }
  const overlapScore = matches / memTokens.length;

  // Category boost: user/preference memories are always somewhat relevant
  const categoryBoost =
    memory.category === "user" ? 0.3 :
    memory.category === "preference" ? 0.2 :
    memory.category === "methodology" ? 0.15 : 0;

  // Recency boost: more recent = slightly more relevant
  const ageMs = Date.now() - new Date(memory.lastRelevantAt).getTime();
  const ageDays = ageMs / 86400000;
  const recencyBoost = Math.max(0, 0.1 - ageDays * 0.001);

  // Frequency boost
  const freqBoost = Math.min(0.1, memory.relevanceCount * 0.02);

  return overlapScore + categoryBoost + recencyBoost + freqBoost;
}

const MIN_RELEVANCE_SCORE = 0.15;
const MAX_INJECTED_MEMORIES = 15;
const ALWAYS_INCLUDE_CATEGORIES: Memory["category"][] = ["user", "preference"];

/**
 * Select memories relevant to the user's query.
 * User/preference memories are always included (identity context).
 * Project/methodology/context memories are scored and only top matches are included.
 */
export function selectRelevantMemories(
  allMemories: Memory[],
  userQuery: string
): Memory[] {
  if (allMemories.length === 0) return [];

  const queryTokens = new Set(tokenize(userQuery));

  // Always include user identity and preferences (capped)
  const alwaysInclude = allMemories.filter((m) =>
    ALWAYS_INCLUDE_CATEGORIES.includes(m.category)
  );

  // Score the rest
  const candidates = allMemories
    .filter((m) => !ALWAYS_INCLUDE_CATEGORIES.includes(m.category))
    .map((m) => ({ memory: m, score: scoreRelevance(m, queryTokens) }))
    .filter((c) => c.score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.score - a.score);

  const selected = [
    ...alwaysInclude.slice(0, 5), // Max 5 identity memories
    ...candidates.slice(0, MAX_INJECTED_MEMORIES - Math.min(alwaysInclude.length, 5)).map((c) => c.memory),
  ];

  // Update relevance timestamps for selected memories
  const now = new Date().toISOString();
  for (const m of selected) {
    m.lastRelevantAt = now;
  }

  return selected;
}

// ── Format for System Prompt ────────────────────────────────────────────────

export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const global = memories.filter((m) => m.scope === "global");
  const project = memories.filter((m) => m.scope === "project");

  const sections: string[] = ["## Relevant Context"];

  if (global.length > 0) {
    sections.push("**About you:**");
    for (const m of global) sections.push(`- ${m.content}`);
  }

  if (project.length > 0) {
    sections.push("**This project:**");
    for (const m of project) sections.push(`- ${m.content}`);
  }

  return sections.join("\n");
}
