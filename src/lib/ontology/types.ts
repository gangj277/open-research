// ── Ontology Types ─────────────────────────────────────────────────────────

export type NoteKind = "source" | "finding" | "claim" | "question" | "method" | "insight";
export type Confidence = "established" | "supported" | "hypothesized" | "questioned" | "refuted";
export type EdgeRelation = "supports" | "contradicts" | "derived-from" | "relates-to";
export type EdgeStrength = "strong" | "moderate" | "weak";

export interface SourceMeta {
  authors?: string;
  year?: number;
  venue?: string;
  url?: string;
  doi?: string;
  filePath?: string;
}

export interface Edge {
  targetId: string;
  relation: EdgeRelation;
  strength: EdgeStrength;
  direction: "directed" | "mutual";
  context: string;
}

export interface Note {
  id: string;
  content: string;
  kind: NoteKind;
  confidence: Confidence;
  meta?: SourceMeta;
  edges: Edge[];
  createdAt: string;
  updatedAt: string;
}

export interface Ontology {
  version: 1;
  notes: Note[];
}

// ── Ontology Manager Input ─────────────────────────────────────────────────

export interface OntologyManagerInput {
  userMessage: string;
  agentResponse: string;
  toolOutputs: Array<{ tool: string; input: string; output: string }>;
  sessionId: string;
  turnIndex: number;
}

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_CONFIDENCE: Record<NoteKind, Confidence> = {
  source: "established",
  finding: "established",
  claim: "hypothesized",
  question: "questioned",
  method: "established",
  insight: "hypothesized",
};

export const NOTE_KINDS: NoteKind[] = ["source", "finding", "claim", "question", "method", "insight"];
export const CONFIDENCE_LEVELS: Confidence[] = ["established", "supported", "hypothesized", "questioned", "refuted"];
export const EDGE_RELATIONS: EdgeRelation[] = ["supports", "contradicts", "derived-from", "relates-to"];
export const EDGE_STRENGTHS: EdgeStrength[] = ["strong", "moderate", "weak"];
