import fs from "node:fs/promises";
import path from "node:path";
import type { Ontology } from "./types";

// ── Paths ──────────────────────────────────────────────────────────────────

export function getOntologyPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".open-research", "ontology.json");
}

// ── Load ───────────────────────────────────────────────────────────────────

const EMPTY_ONTOLOGY: Ontology = { version: 1, notes: [] };

export async function loadOntology(workspaceDir: string): Promise<Ontology> {
  try {
    const raw = await fs.readFile(getOntologyPath(workspaceDir), "utf8");
    const parsed = JSON.parse(raw) as Ontology;
    if (!parsed.notes || !Array.isArray(parsed.notes)) return { ...EMPTY_ONTOLOGY };
    return parsed;
  } catch {
    return { ...EMPTY_ONTOLOGY };
  }
}

// ── Save (Atomic) ──────────────────────────────────────────────────────────

export async function saveOntology(
  ontology: Ontology,
  workspaceDir: string
): Promise<void> {
  const filePath = getOntologyPath(workspaceDir);
  const tmpPath = filePath + ".tmp";

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(ontology, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

// ── Cleanup stale .tmp on startup ──────────────────────────────────────────

export async function cleanupStaleTmp(workspaceDir: string): Promise<void> {
  const tmpPath = getOntologyPath(workspaceDir) + ".tmp";
  try {
    await fs.unlink(tmpPath);
  } catch {
    // No stale tmp — fine
  }
}
