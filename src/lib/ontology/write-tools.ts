import type {
  Ontology,
  Note,
  NoteKind,
  Confidence,
  EdgeRelation,
  EdgeStrength,
  SourceMeta,
} from "./types";
import { DEFAULT_CONFIDENCE } from "./types";

// ── create_note ────────────────────────────────────────────────────────────

export function createNote(
  ontology: Ontology,
  params: {
    content: string;
    kind: NoteKind;
    confidence?: Confidence;
    meta?: SourceMeta;
  }
): { ontology: Ontology; noteId: string } {
  const noteId = crypto.randomUUID();
  const now = new Date().toISOString();

  const note: Note = {
    id: noteId,
    content: params.content,
    kind: params.kind,
    confidence: params.confidence ?? DEFAULT_CONFIDENCE[params.kind],
    meta: params.kind === "source" ? params.meta : undefined,
    edges: [],
    createdAt: now,
    updatedAt: now,
  };

  ontology.notes.push(note);
  return { ontology, noteId };
}

// ── create_edge ────────────────────────────────────────────────────────────

export function createEdge(
  ontology: Ontology,
  params: {
    sourceNoteId: string;
    targetNoteId: string;
    relation: EdgeRelation;
    strength: EdgeStrength;
    direction: "directed" | "mutual";
    context: string;
  }
): { ontology: Ontology; edgeId: string } {
  const sourceNote = ontology.notes.find((n) => n.id === params.sourceNoteId);
  if (!sourceNote) {
    throw new Error(`Source note not found: ${params.sourceNoteId}`);
  }

  const targetExists = ontology.notes.some((n) => n.id === params.targetNoteId);
  if (!targetExists) {
    throw new Error(`Target note not found: ${params.targetNoteId}`);
  }

  // Check for duplicate edge
  const duplicate = sourceNote.edges.find(
    (e) => e.targetId === params.targetNoteId && e.relation === params.relation
  );
  if (duplicate) {
    throw new Error(
      `Edge already exists: ${params.sourceNoteId} → ${params.targetNoteId} (${params.relation})`
    );
  }

  sourceNote.edges.push({
    targetId: params.targetNoteId,
    relation: params.relation,
    strength: params.strength,
    direction: params.direction,
    context: params.context,
  });

  sourceNote.updatedAt = new Date().toISOString();

  const edgeId = `${params.sourceNoteId}→${params.targetNoteId}:${params.relation}`;
  return { ontology, edgeId };
}

// ── update_note ────────────────────────────────────────────────────────────

export function updateNote(
  ontology: Ontology,
  params: {
    noteId: string;
    content?: string;
    confidence?: Confidence;
  }
): Ontology {
  const note = ontology.notes.find((n) => n.id === params.noteId);
  if (!note) throw new Error(`Note not found: ${params.noteId}`);

  if (params.content !== undefined) note.content = params.content;
  if (params.confidence !== undefined) note.confidence = params.confidence;
  note.updatedAt = new Date().toISOString();

  return ontology;
}

// ── update_edge ────────────────────────────────────────────────────────────

export function updateEdge(
  ontology: Ontology,
  params: {
    sourceNoteId: string;
    targetNoteId: string;
    relation: EdgeRelation;
    strength?: EdgeStrength;
    context?: string;
  }
): Ontology {
  const sourceNote = ontology.notes.find((n) => n.id === params.sourceNoteId);
  if (!sourceNote) throw new Error(`Source note not found: ${params.sourceNoteId}`);

  const edge = sourceNote.edges.find(
    (e) => e.targetId === params.targetNoteId && e.relation === params.relation
  );
  if (!edge) {
    throw new Error(
      `Edge not found: ${params.sourceNoteId} → ${params.targetNoteId} (${params.relation})`
    );
  }

  if (params.strength !== undefined) edge.strength = params.strength;
  if (params.context !== undefined) edge.context = params.context;
  sourceNote.updatedAt = new Date().toISOString();

  return ontology;
}

// ── remove_edge ────────────────────────────────────────────────────────────

export function removeEdge(
  ontology: Ontology,
  params: {
    sourceNoteId: string;
    targetNoteId: string;
    relation: EdgeRelation;
  }
): Ontology {
  const sourceNote = ontology.notes.find((n) => n.id === params.sourceNoteId);
  if (!sourceNote) throw new Error(`Source note not found: ${params.sourceNoteId}`);

  const idx = sourceNote.edges.findIndex(
    (e) => e.targetId === params.targetNoteId && e.relation === params.relation
  );
  if (idx === -1) {
    throw new Error(
      `Edge not found: ${params.sourceNoteId} → ${params.targetNoteId} (${params.relation})`
    );
  }

  sourceNote.edges.splice(idx, 1);
  sourceNote.updatedAt = new Date().toISOString();

  return ontology;
}

// ── merge_notes ────────────────────────────────────────────────────────────

const STRENGTH_RANK: Record<EdgeStrength, number> = {
  strong: 3,
  moderate: 2,
  weak: 1,
};

export function mergeNotes(
  ontology: Ontology,
  params: {
    keepNoteId: string;
    removeNoteId: string;
    mergedContent?: string;
  }
): { ontology: Ontology; edgesRedirected: number } {
  const keepNote = ontology.notes.find((n) => n.id === params.keepNoteId);
  if (!keepNote) throw new Error(`Keep note not found: ${params.keepNoteId}`);

  const removeNote = ontology.notes.find((n) => n.id === params.removeNoteId);
  if (!removeNote) throw new Error(`Remove note not found: ${params.removeNoteId}`);

  let edgesRedirected = 0;

  // 1. Redirect all edges on other notes that point to removeNoteId → keepNoteId
  for (const note of ontology.notes) {
    if (note.id === params.removeNoteId) continue;
    for (const edge of note.edges) {
      if (edge.targetId === params.removeNoteId) {
        edge.targetId = params.keepNoteId;
        edgesRedirected++;
      }
    }
  }

  // 2. Move edges from removeNote to keepNote (if not duplicates)
  for (const edge of removeNote.edges) {
    // Skip self-referential edges that would point to the removed note
    const targetId = edge.targetId === params.removeNoteId ? params.keepNoteId : edge.targetId;
    if (targetId === params.keepNoteId) continue; // skip self-edge

    const existing = keepNote.edges.find(
      (e) => e.targetId === targetId && e.relation === edge.relation
    );
    if (existing) {
      // Keep the stronger edge
      if (STRENGTH_RANK[edge.strength] > STRENGTH_RANK[existing.strength]) {
        existing.strength = edge.strength;
        existing.context = edge.context;
      }
    } else {
      keepNote.edges.push({ ...edge, targetId });
    }
  }

  // 3. Deduplicate edges on keepNote (same target + relation → keep strongest)
  const edgeMap = new Map<string, typeof keepNote.edges[number]>();
  for (const edge of keepNote.edges) {
    const key = `${edge.targetId}:${edge.relation}`;
    const existing = edgeMap.get(key);
    if (!existing || STRENGTH_RANK[edge.strength] > STRENGTH_RANK[existing.strength]) {
      edgeMap.set(key, edge);
    }
  }
  keepNote.edges = [...edgeMap.values()];

  // 4. Update keepNote content if mergedContent provided
  if (params.mergedContent) {
    keepNote.content = params.mergedContent;
  }
  keepNote.updatedAt = new Date().toISOString();

  // 5. Remove the note
  ontology.notes = ontology.notes.filter((n) => n.id !== params.removeNoteId);

  return { ontology, edgesRedirected };
}
