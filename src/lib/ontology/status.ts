import type { Ontology, NoteKind } from "./types";
import { NOTE_KINDS } from "./types";

/**
 * Generate a human-readable ontology status summary.
 * Used by ontology_status tool and /ontology slash command.
 */
export function getOntologyStatus(ontology: Ontology): string {
  const { notes } = ontology;

  if (notes.length === 0) {
    return "Ontology: empty — no notes yet.";
  }

  // Count by kind
  const kindCounts: Record<NoteKind, number> = {
    source: 0, finding: 0, claim: 0, question: 0, method: 0, insight: 0,
  };
  for (const note of notes) {
    kindCounts[note.kind]++;
  }

  // Count contradictions (unique pairs — each contradiction edge counted once)
  const contradictionPairs = new Set<string>();
  for (const note of notes) {
    for (const edge of note.edges) {
      if (edge.relation === "contradicts") {
        const pair = [note.id, edge.targetId].sort().join(":");
        contradictionPairs.add(pair);
      }
    }
  }

  // Count unsupported claims: claims with no incoming "supports" edges
  const supportedClaimIds = new Set<string>();
  for (const note of notes) {
    for (const edge of note.edges) {
      if (edge.relation === "supports") {
        supportedClaimIds.add(edge.targetId);
      }
    }
  }
  const unsupportedClaims = notes.filter(
    (n) => n.kind === "claim" && !supportedClaimIds.has(n.id)
  );

  // Count open questions
  const openQuestions = notes.filter((n) => n.kind === "question");

  // Format
  const lines: string[] = [`Ontology: ${notes.length} notes`];

  for (const kind of NOTE_KINDS) {
    const count = kindCounts[kind];
    if (count === 0) continue;
    let suffix = "";
    if (kind === "claim") {
      const parts: string[] = [];
      if (unsupportedClaims.length > 0) parts.push(`${unsupportedClaims.length} unsupported`);
      const refuted = notes.filter((n) => n.kind === "claim" && n.confidence === "refuted").length;
      if (refuted > 0) parts.push(`${refuted} refuted`);
      if (parts.length > 0) suffix = ` (${parts.join(", ")})`;
    }
    const label = kind.charAt(0).toUpperCase() + kind.slice(1) + "s";
    lines.push(`  ${label}: ${count}${suffix}`);
  }

  if (contradictionPairs.size > 0 || unsupportedClaims.length > 0 || openQuestions.length > 0) {
    lines.push("");
    if (contradictionPairs.size > 0) lines.push(`Contradictions: ${contradictionPairs.size}`);
    if (unsupportedClaims.length > 0) lines.push(`Unsupported claims: ${unsupportedClaims.length}`);
    if (openQuestions.length > 0) lines.push(`Open questions: ${openQuestions.length}`);
  }

  return lines.join("\n");
}

/**
 * Format a list of claims with their evidence counts.
 */
export function formatClaims(ontology: Ontology): string {
  const claims = ontology.notes.filter((n) => n.kind === "claim");
  if (claims.length === 0) return "No claims in ontology.";

  // Count incoming supports/contradicts for each claim
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

  return claims
    .map((c) => {
      const s = supportCount.get(c.id) ?? 0;
      const ct = contradictCount.get(c.id) ?? 0;
      return `[${c.id.slice(0, 8)}] "${c.content}" (${c.confidence})\n  Supports: ${s}  Contradicts: ${ct}`;
    })
    .join("\n\n");
}

/**
 * Format all contradiction pairs.
 */
export function formatConflicts(ontology: Ontology): string {
  const pairs: Array<{ a: string; b: string; context: string }> = [];
  const seen = new Set<string>();

  for (const note of ontology.notes) {
    for (const edge of note.edges) {
      if (edge.relation !== "contradicts") continue;
      const pairKey = [note.id, edge.targetId].sort().join(":");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const target = ontology.notes.find((n) => n.id === edge.targetId);
      if (!target) continue;

      pairs.push({
        a: note.content,
        b: target.content,
        context: edge.context,
      });
    }
  }

  if (pairs.length === 0) return "No contradictions found.";

  return pairs
    .map(
      (p, i) =>
        `CONTRADICTION ${i + 1}:\n  "${p.a}"\n  vs.\n  "${p.b}"\n  Context: ${p.context}`
    )
    .join("\n\n");
}
