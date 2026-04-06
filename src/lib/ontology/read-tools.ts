import type {
  Ontology,
  Note,
  NoteKind,
  Confidence,
  EdgeRelation,
  SourceMeta,
} from "./types";

// ── Tokenizer (shared with BM25) ──────────────────────────────────────────

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

// ── get_note ───────────────────────────────────────────────────────────────

export function getNote(ontology: Ontology, noteId: string): Note | null {
  return ontology.notes.find((n) => n.id === noteId) ?? null;
}

// ── search_notes (Structural Filters + BM25) ──────────────────────────────

export interface SearchParams {
  queries?: string[];
  kind?: NoteKind;
  confidence?: Confidence;
  hasEdge?: EdgeRelation;
  missingEdge?: EdgeRelation;
  limit?: number;
}

/**
 * Check if a note has incoming mutual edges of a given relation from other notes.
 */
function hasMutualIncoming(
  ontology: Ontology,
  noteId: string,
  relation: EdgeRelation
): boolean {
  return ontology.notes.some((other) =>
    other.id !== noteId &&
    other.edges.some(
      (e) => e.targetId === noteId && e.relation === relation && e.direction === "mutual"
    )
  );
}

export function searchNotes(ontology: Ontology, params: SearchParams): Note[] {
  const { queries, kind, confidence, hasEdge, missingEdge, limit = 10 } = params;

  // ── Phase 1: Structural filters ────────────────────────────────────────

  let candidates = ontology.notes;

  if (kind) {
    candidates = candidates.filter((n) => n.kind === kind);
  }
  if (confidence) {
    candidates = candidates.filter((n) => n.confidence === confidence);
  }
  if (hasEdge) {
    candidates = candidates.filter(
      (n) =>
        n.edges.some((e) => e.relation === hasEdge) ||
        hasMutualIncoming(ontology, n.id, hasEdge)
    );
  }
  if (missingEdge) {
    candidates = candidates.filter(
      (n) =>
        !n.edges.some((e) => e.relation === missingEdge) &&
        !hasMutualIncoming(ontology, n.id, missingEdge)
    );
  }

  // ── Phase 2: BM25 text ranking (only if queries provided) ─────────────

  if (!queries || queries.length === 0) {
    return candidates
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  const queryTokenSets = queries.map((q) => tokenize(q));

  // Corpus stats
  const N = candidates.length;
  if (N === 0) return [];

  const docTokensCache = new Map<string, string[]>();
  let totalDocLen = 0;
  for (const note of candidates) {
    const tokens = tokenize(note.content);
    docTokensCache.set(note.id, tokens);
    totalDocLen += tokens.length;
  }
  const avgDocLen = totalDocLen / N;

  // Document frequency: token → how many candidates contain it
  const df = new Map<string, number>();
  for (const note of candidates) {
    const uniqueTokens = new Set(docTokensCache.get(note.id)!);
    for (const token of uniqueTokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  // BM25 parameters
  const k1 = 1.2;
  const b = 0.75;

  const scored = candidates.map((note) => {
    const noteTokens = docTokensCache.get(note.id)!;
    const docLen = noteTokens.length;

    // Term frequencies
    const tf = new Map<string, number>();
    for (const token of noteTokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Score against each query phrase, take the best
    let bestBM25 = 0;
    for (const queryTokens of queryTokenSets) {
      let score = 0;
      for (const qt of queryTokens) {
        const termFreq = tf.get(qt) ?? 0;
        const docFreq = df.get(qt) ?? 0;
        if (termFreq === 0) continue;

        // IDF: rare terms score higher
        const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

        // TF with saturation + length normalization
        const tfNorm =
          (termFreq * (k1 + 1)) /
          (termFreq + k1 * (1 - b + b * docLen / avgDocLen));

        score += idf * tfNorm;
      }
      bestBM25 = Math.max(bestBM25, score);
    }

    // Source metadata bonus
    let metaBonus = 0;
    if (note.kind === "source" && note.meta) {
      const metaText = [
        note.meta.authors,
        note.meta.venue,
        note.meta.year?.toString(),
      ]
        .filter(Boolean)
        .join(" ");
      const metaTokens = new Set(tokenize(metaText));
      for (const queryTokens of queryTokenSets) {
        const hits = queryTokens.filter((qt) => metaTokens.has(qt)).length;
        metaBonus = Math.max(metaBonus, hits * 0.5);
      }
    }

    return { note, score: bestBM25 + metaBonus };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.note);
}

// ── get_connections (BFS traversal) ────────────────────────────────────────

export function getConnections(
  ontology: Ontology,
  noteId: string,
  depth: number = 1
): { root: Note | null; connected: Note[] } {
  const clampedDepth = Math.min(Math.max(depth, 1), 3);
  const root = getNote(ontology, noteId);
  if (!root) return { root: null, connected: [] };

  const visited = new Set<string>([noteId]);
  let frontier = [noteId];

  for (let d = 0; d < clampedDepth; d++) {
    const nextFrontier: string[] = [];

    for (const currentId of frontier) {
      const current = getNote(ontology, currentId);
      if (!current) continue;

      // Outgoing edges
      for (const edge of current.edges) {
        if (!visited.has(edge.targetId)) {
          visited.add(edge.targetId);
          nextFrontier.push(edge.targetId);
        }
      }

      // Incoming mutual edges (other notes pointing to currentId with direction: "mutual")
      for (const other of ontology.notes) {
        if (visited.has(other.id)) continue;
        const hasMutual = other.edges.some(
          (e) => e.targetId === currentId && e.direction === "mutual"
        );
        if (hasMutual) {
          visited.add(other.id);
          nextFrontier.push(other.id);
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Remove root from connected set
  visited.delete(noteId);

  const connected = [...visited]
    .map((id) => getNote(ontology, id))
    .filter((n): n is Note => n !== null);

  return { root, connected };
}

// ── Source Identity Dedup ──────────────────────────────────────────────────

function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findExistingSource(
  ontology: Ontology,
  meta: SourceMeta
): Note | null {
  for (const note of ontology.notes) {
    if (note.kind !== "source" || !note.meta) continue;

    // Match by DOI
    if (meta.doi && note.meta.doi && meta.doi === note.meta.doi) return note;

    // Match by URL
    if (meta.url && note.meta.url && meta.url === note.meta.url) return note;

    // Match by normalized author + year
    if (
      meta.authors &&
      meta.year &&
      note.meta.authors &&
      note.meta.year &&
      meta.year === note.meta.year &&
      normalizeTitle(meta.authors) === normalizeTitle(note.meta.authors)
    ) {
      return note;
    }
  }
  return null;
}
