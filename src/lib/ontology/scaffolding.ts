import type { Ontology, Note, NoteKind } from "./types";
import { getNote } from "./read-tools";

/**
 * Build a brief scaffolding context from relevant note IDs.
 * Injected into the main agent's system prompt to orient it on what
 * exists in the ontology so it knows what to query.
 *
 * Returns null if no relevant notes (nothing to inject).
 * Returns ~300-500 tokens of formatted context.
 */
export function buildScaffoldingContext(
  ontology: Ontology,
  relevantIds: string[]
): string | null {
  if (relevantIds.length === 0) return null;

  // Load relevant notes
  const notes = relevantIds
    .map((id) => getNote(ontology, id))
    .filter((n): n is Note => n !== null);

  if (notes.length === 0) return null;

  // Group by kind
  const byKind = new Map<NoteKind, Note[]>();
  for (const note of notes) {
    const group = byKind.get(note.kind) ?? [];
    group.push(note);
    byKind.set(note.kind, group);
  }

  // Count incoming supports/contradicts for claims
  const supportCount = new Map<string, number>();
  const contradictCount = new Map<string, number>();
  for (const note of ontology.notes) {
    for (const edge of note.edges) {
      if (edge.relation === "supports") {
        supportCount.set(edge.targetId, (supportCount.get(edge.targetId) ?? 0) + 1);
      }
      if (edge.relation === "contradicts") {
        contradictCount.set(edge.targetId, (contradictCount.get(edge.targetId) ?? 0) + 1);
      }
    }
  }

  const lines: string[] = ["## Ontology Context", ""];
  lines.push("Your project ontology contains the following related to this topic:");
  lines.push("");

  // Claims first (most important for scaffolding)
  const claims = byKind.get("claim") ?? [];
  for (const claim of claims) {
    const s = supportCount.get(claim.id) ?? 0;
    const c = contradictCount.get(claim.id) ?? 0;
    const evidence = [];
    if (s > 0) evidence.push(`${s} supporting`);
    if (c > 0) evidence.push(`${c} contradicting`);
    const evidenceStr = evidence.length > 0 ? `, ${evidence.join(", ")}` : "";
    lines.push(`- CLAIM: "${truncate(claim.content, 120)}" (${claim.confidence}${evidenceStr})`);
  }

  // Findings — summarize by source
  const findings = byKind.get("finding") ?? [];
  if (findings.length > 0) {
    const sourceNames = new Set<string>();
    for (const f of findings) {
      for (const edge of f.edges) {
        if (edge.relation === "derived-from") {
          const source = getNote(ontology, edge.targetId);
          if (source) sourceNames.add(truncate(source.content, 40));
        }
      }
    }
    const from = sourceNames.size > 0 ? ` from ${[...sourceNames].join(", ")}` : "";
    lines.push(`- ${findings.length} finding${findings.length !== 1 ? "s" : ""}${from}`);
  }

  // Sources
  const sources = byKind.get("source") ?? [];
  if (sources.length > 0) {
    lines.push(`- ${sources.length} source${sources.length !== 1 ? "s" : ""}: ${sources.map((s) => truncate(s.content, 40)).join(", ")}`);
  }

  // Questions
  const questions = byKind.get("question") ?? [];
  for (const q of questions) {
    lines.push(`- QUESTION: "${truncate(q.content, 100)}"`);
  }

  // Methods
  const methods = byKind.get("method") ?? [];
  if (methods.length > 0) {
    lines.push(`- ${methods.length} method${methods.length !== 1 ? "s" : ""}`);
  }

  // Insights
  const insights = byKind.get("insight") ?? [];
  for (const ins of insights) {
    lines.push(`- INSIGHT: "${truncate(ins.content, 100)}"`);
  }

  // Warnings: contradictions
  const hasContradictions = claims.some((c) => (contradictCount.get(c.id) ?? 0) > 0);
  if (hasContradictions) {
    lines.push("");
    lines.push("\u26A0 There is contradicting evidence on one or more claims.");
  }

  // Unsupported claims
  const unsupported = claims.filter((c) => (supportCount.get(c.id) ?? 0) === 0);
  if (unsupported.length > 0) {
    lines.push(`\u26A0 ${unsupported.length} claim${unsupported.length !== 1 ? "s have" : " has"} no supporting evidence yet.`);
  }

  lines.push("");
  lines.push("Use query_ontology to get full details on any of the above.");

  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
}
