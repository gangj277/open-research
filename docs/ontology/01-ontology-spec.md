# Ontology Spec

## Core Principle

Everything is a Note. A paper is a Note. A finding is a Note. A claim, a question, an insight — all Notes. They differ by `kind`, not by type. Connections between Notes are edges. Provenance, evidence, contradiction, synthesis — all edges. No special cases.

## Note

```typescript
interface Note {
  id: string;                  // UUID
  content: string;             // Natural language description
  kind: NoteKind;
  confidence: Confidence;
  meta?: SourceMeta;           // Only populated for kind: "source"
  edges: Edge[];
  createdAt: string;           // ISO 8601
  updatedAt: string;           // ISO 8601
}
```

### Kinds

6 values. Closed set — extendable only by schema change.

| Kind | What it represents | Examples |
|------|--------------------|----------|
| `source` | A citable origin — paper, URL, dataset, experiment, book | "Vaswani et al. 2017, Attention Is All You Need" |
| `finding` | A specific result extracted from a source | "Table 3: 12% BLEU improvement, p<0.01, on WMT14 EN-DE" |
| `claim` | An argument or assertion being made in the research | "Transformer architectures outperform RNNs on long-range dependency tasks" |
| `question` | An open thread, gap, or uncertainty | "Does this efficiency advantage hold for sequences longer than 100K tokens?" |
| `method` | A methodology, technique, or analytical approach | "5-fold stratified cross-validation with domain-balanced splits" |
| `insight` | A synthesis or interpretation that connects multiple pieces | "The contradiction between Smith and Chen is likely explained by a 10x difference in training data size" |

```typescript
type NoteKind = "source" | "finding" | "claim" | "question" | "method" | "insight";
```

### Confidence

5 levels. Represents how well-established a Note is.

| Level | Meaning | Typical usage |
|-------|---------|---------------|
| `established` | Strong evidence, widely accepted, directly observed | Findings with clear data, published results |
| `supported` | Has evidence but not definitive | Claims with some supporting findings |
| `hypothesized` | Proposed but unverified | New ideas, working assumptions |
| `questioned` | Doubt has been raised | Claims with contradicting evidence, open questions |
| `refuted` | Counter-evidence outweighs support | Disproven hypotheses, retracted claims |

```typescript
type Confidence = "established" | "supported" | "hypothesized" | "questioned" | "refuted";
```

**Default confidence by kind:**

| Kind | Default confidence | Reasoning |
|------|--------------------|-----------|
| `source` | `established` | A source exists — that's a fact |
| `finding` | `established` | Extracted directly from a source |
| `claim` | `hypothesized` | Claims start unverified until evidence connects |
| `question` | `questioned` | Questions are inherently uncertain |
| `method` | `established` | A method was used — that's a fact |
| `insight` | `hypothesized` | Syntheses start as hypotheses |

### Source Metadata

Only populated when `kind === "source"`. Optional fields — not every source has all of them.

```typescript
interface SourceMeta {
  authors?: string;          // "Vaswani, Shazeer, Parmar, et al."
  year?: number;             // 2017
  venue?: string;            // "NeurIPS 2017"
  url?: string;              // "https://arxiv.org/abs/1706.03762"
  doi?: string;              // "10.48550/arXiv.1706.03762"
  filePath?: string;         // "sources/vaswani-2017.pdf" (workspace-relative)
}
```

## Edge

Edges live on one Note and point to another. Some relations are inherently directional (A supports B ≠ B supports A), others are mutual (A contradicts B = B contradicts A).

```typescript
interface Edge {
  targetId: string;          // ID of the Note this edge points to
  relation: EdgeRelation;
  strength: EdgeStrength;
  direction: "directed" | "mutual";
  context: string;           // Natural language explanation of WHY this connection exists
}
```

`directed` — the edge only has meaning from source → target. Traversal follows the arrow.

`mutual` — the relationship holds in both directions. The edge is stored on one Note but when querying, both sides see it. No duplication needed — the query layer treats `mutual` edges as bidirectional.

### Relations

4 values. Each has a natural directionality.

| Relation | Meaning | Default direction | Example |
|----------|---------|-------------------|---------|
| `supports` | A provides evidence for B | `directed` | "Their BLEU improvement on WMT14 directly validates the efficiency argument" |
| `contradicts` | A and B are in tension | `mutual` | "Chen's results on larger datasets show opposite scaling behavior" |
| `derived-from` | A was produced from B — provenance or synthesis | `directed` | "Extracted from Table 3 of the original paper" |
| `relates-to` | A and B are topically connected, no directional claim | `mutual` | "Both address attention mechanism efficiency but from different angles" |

```typescript
type EdgeRelation = "supports" | "contradicts" | "derived-from" | "relates-to";
```

**`derived-from` is provenance.** "Finding X `derived-from` Source Y" means "X was extracted from Y." "Insight Z `derived-from` [Finding A, Finding B]" means "Z was synthesized by combining A and B." This replaces the need for a separate `sourceRef` field.

**`relates-to` is the catch-all.** When two Notes are connected but not in a supports/contradicts/derived-from way. Use sparingly — prefer the more specific relations.

### Strength

3 levels. How strong is this connection?

| Strength | Meaning | When to use |
|----------|---------|-------------|
| `strong` | Direct, unambiguous connection | "Table 3 explicitly tests this exact hypothesis" |
| `moderate` | Relevant but indirect or partial | "The methodology is similar but applied to a different domain" |
| `weak` | Tangential or speculative connection | "Might be related based on shared terminology" |

```typescript
type EdgeStrength = "strong" | "moderate" | "weak";
```

### Context

The `context` field is the most important field on an edge. It's a natural language string explaining **why** this connection exists and **what specifically** makes it a support, contradiction, derivation, or relation.

Good context:
- `"Found in Table 3: 12% BLEU improvement with p<0.01 on WMT14 EN-DE, directly testing the same hypothesis on the same benchmark"`
- `"Chen used a 10x larger training set and observed inverse scaling, suggesting the original finding is dataset-size-dependent"`
- `"Combined the sample size observation from Smith with the scaling curve from Jones to hypothesize diminishing returns above 10B parameters"`

Bad context:
- `"supports the claim"` (says nothing — the relation field already says this)
- `"from this paper"` (says nothing — the edge already points to the source)
- `"related"` (says nothing — the relation field already says this)

The context must add information beyond what the relation and strength already convey.

## Complete Schema

```typescript
type NoteKind = "source" | "finding" | "claim" | "question" | "method" | "insight";
type Confidence = "established" | "supported" | "hypothesized" | "questioned" | "refuted";
type EdgeRelation = "supports" | "contradicts" | "derived-from" | "relates-to";
type EdgeStrength = "strong" | "moderate" | "weak";

interface SourceMeta {
  authors?: string;
  year?: number;
  venue?: string;
  url?: string;
  doi?: string;
  filePath?: string;
}

interface Edge {
  targetId: string;
  relation: EdgeRelation;
  strength: EdgeStrength;
  direction: "directed" | "mutual";
  context: string;
}

interface Note {
  id: string;
  content: string;
  kind: NoteKind;
  confidence: Confidence;
  meta?: SourceMeta;
  edges: Edge[];
  createdAt: string;
  updatedAt: string;
}

interface Ontology {
  version: 1;
  notes: Note[];
}
```

## Scope & Storage

The ontology is **per-workspace only**. Each research project has its own ontology. No global ontology.

```
~/.open-research/
  └── memory.json              ← Global: WHO the researcher is, HOW they work
                                  (identity, preferences, methodology habits)

<workspace>/.open-research/
  ├── project.json             ← Workspace metadata
  ├── memory.json              ← Project context: deadlines, collaborators, constraints
  ├── ontology.json            ← WHAT the researcher knows: sources, findings, claims, evidence
  └── sessions/                ← Chat history
```

### Memory vs Ontology — Clear Boundary

| | Memory | Ontology |
|---|--------|----------|
| **What it stores** | WHO the researcher is, HOW they work | WHAT they know, WHAT the evidence says |
| **Scope** | Global (identity, preferences, methodology) + per-project (deadlines, collaborators) | Per-workspace only |
| **Structure** | Flat list of text with categories | Graph of Notes with typed edges |
| **Categories** | `user`, `preference`, `methodology`, `context` | `source`, `finding`, `claim`, `question`, `method`, `insight` |
| **Examples** | "PhD student at MIT", "Prefers APA citations", "Deadline April 15" | "Smith 2024 found 12% BLEU improvement", "Efficiency claim contradicted by Chen 2023" |
| **Written by** | Memory extractor (after each turn) | Ontology manager (after each turn) |

The memory extractor explicitly does NOT capture findings, claims, hypotheses, or evidence — those are the ontology's domain. Memory captures researcher identity and project logistics.

**Why per-workspace for ontology:**
- A research project has a specific evidence network. "Transformer efficiency" and "climate policy" are different ontologies with different sources, claims, and connections. Mixing them makes every query noisier.
- Starting a new project means starting a fresh ontology. No irrelevant baggage from previous work.
- The workspace is portable — copy the folder, the ontology comes with it.

**Cross-project references (future):**
If a researcher wants to link a finding from project A into project B, that's a future feature — import/reference notes across workspaces. Not needed for v1.

## Counts

| Concept | Count |
|---------|-------|
| Node types | 1 (`Note`) |
| Note kinds | 6 |
| Confidence levels | 5 |
| Edge relations | 4 |
| Edge strengths | 3 |
| Edge directions | 2 (`directed`, `mutual`) |
| **Total concepts** | **21** |

## Queries the Ontology Must Support

These are the questions researchers actually ask. Each must be answerable by traversing the ontology.

| Question | How to answer |
|----------|---------------|
| "What evidence supports claim X?" | Find all Notes with edge `supports` → X |
| "What contradicts claim X?" | Find all Notes with edge `contradicts` → X |
| "Where did finding Y come from?" | Follow Y's `derived-from` edges to source Notes |
| "What's unresolved?" | All Notes with kind `question` or confidence `questioned` |
| "What claims have no evidence?" | Notes with kind `claim` that have zero incoming `supports` edges |
| "What did paper Z contribute?" | Find all Notes with `derived-from` → Z |
| "How did we arrive at insight W?" | Follow W's `derived-from` edges recursively |
| "What are the main contradictions?" | All pairs connected by `contradicts` edges |
| "Show me everything about topic T?" | Full-text search on `content`, then follow edges 1-2 hops |
