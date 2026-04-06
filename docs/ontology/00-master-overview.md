# Open Research Ontology — Master Overview

## What We're Building

An ontology that lives inside our research CLI and automatically structures everything the researcher and agent discover into connected, evidence-traced knowledge. It evolves the existing memory system from a flat list of text into a graph of notes with typed relationships.

The ontology is not a feature the user interacts with directly. It's infrastructure that makes the agent fundamentally smarter about the researcher's project — tracking which papers said what, what supports or contradicts their claims, where the gaps are, and how their arguments chain together.

## Why We're Building This

### The Researcher's Problem

A researcher 3 weeks into a literature review has read 40+ papers, taken scattered notes, and has a rough sense of their argument. When they sit down to write, they hit the same walls every time:

1. **"Where did I read that?"** — They remember a finding but not which paper. They waste 30 minutes re-searching something they already read.

2. **"Does anything contradict this?"** — They write a claim. Somewhere in their 40 papers there's counter-evidence. They forgot. Their reviewer won't.

3. **"Is my argument actually supported?"** — Their reasoning goes A → B → C. But B is an assumption they never verified. They don't notice until peer review.

4. **"What should I read next?"** — They've covered one angle thoroughly but have a blind spot. They don't know what they don't know.

### Why an Ontology Solves This

A flat list of notes can tell you "Smith 2024 found X." Only an ontology can tell you:

- "Smith 2024 found X, **which contradicts** your claim Y, **which you based on** Jones 2023, **who used a different methodology**"
- "Your main claim has 3 supporting findings but **1 contradiction you haven't addressed**"
- "You have **2 claims with no supporting evidence** and **5 open questions**"

The relationships between facts are where research rigor lives. An ontology preserves them. A list doesn't.

### Why No Other Tool Does This

Every AI coding agent can summarize documents and generate text. None of them:

- Track where specific claims came from
- Detect contradictions across sources
- Maintain evidence chains that persist across sessions
- Tell the researcher "your argument has a gap here"

This is the core differentiator of Open Research.

---

## Architecture

### Four Agents, Four Concerns

```
User sends message
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  RELEVANCE AGENT (gpt-5.4-mini, <1 sec)                             │
│  Receives: user message + compact note list                         │
│  Returns: IDs of relevant notes → fed into scaffolding              │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SCAFFOLDING LAYER (code, instant)                                   │
│  Loads full notes for relevant IDs, formats brief summary            │
│  Injects into main agent's system prompt as orientation context      │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  MAIN AGENT (gpt-5.4)                                                │
│  Does research: reads papers, runs code, writes drafts               │
│  Has 2 ontology tools: query_ontology, ontology_status               │
│                                                                      │
│  When it calls query_ontology:                                       │
│    ┌──────────────────────────────────────────────────┐               │
│    │  QUERY AGENT (gpt-5.4-mini)                      │               │
│    │  Read tools: get_note, search_notes,             │               │
│    │  get_connections                                  │               │
│    │  Traverses ontology → returns synthesized answer  │               │
│    └──────────────────────────────────────────────────┘               │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           │ turn fully complete
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ONTOLOGY MANAGER (gpt-5.4, background, non-blocking)                │
│  Read tools: get_note, search_notes, get_connections                 │
│  Write tools: create_note, create_edge, update_note, update_edge,   │
│               remove_edge, merge_notes                               │
│  Receives full turn context → updates ontology.json                  │
└──────────────────────────────────────────────────────────────────────┘
```

| Agent | Model | When | Purpose |
|-------|-------|------|---------|
| Relevance Agent | gpt-5.4-mini | Before main agent starts | Semantic matching — picks relevant note IDs from compact list |
| Main Agent | gpt-5.4 | During user interaction | Does the actual research work |
| Query Agent | gpt-5.4-mini | When main agent calls `query_ontology` | Traverses ontology deeply, returns synthesized answers |
| Ontology Manager | gpt-5.4 | After turn completes (background) | Structures knowledge from conversation into the ontology |

**Why four agents:**
- **Relevance agent** replaces keyword matching with semantic understanding. It knows "computational complexity of self-attention" matches "quadratic scaling in dot-product attention" — keyword overlap wouldn't catch that.
- **Main agent** stays focused on research. Its prompt and tool set aren't polluted with ontology internals.
- **Query agent** reads the ontology deeply and returns synthesized conclusions. Main agent asks in English, gets back English — no raw graph data.
- **Ontology manager** writes to the ontology with high precision. Uses gpt-5.4 because edge quality is critical.

### Two Layers for Ontology Reading

**Layer 1 — Scaffolding (relevance agent + code):**

Before the main agent starts, the relevance agent picks semantically relevant note IDs from a compact list, then the scaffolding code loads those notes and formats a brief orientation summary (~300-500 tokens). This tells the agent what exists so it knows what to query. It's a table of contents, not the full book.

**Layer 2 — Query Agent (active, LLM-powered, on-demand):**

When the main agent needs actual detail, it calls `query_ontology("what contradicts our efficiency claim")`. The query agent uses read tools to traverse the ontology and returns a synthesized answer.

The scaffolding layer makes the active layer smarter — the agent knows what to ask because it was told what exists.

---

## Ontology

### One Node Type

Everything is a `Note`. A paper, a finding, a claim, a question — all Notes. They differ by `kind`, not by type.

```typescript
interface Note {
  id: string;
  content: string;               // Natural language description
  kind: NoteKind;                // "source" | "finding" | "claim" | "question" | "method" | "insight"
  confidence: Confidence;        // "established" | "supported" | "hypothesized" | "questioned" | "refuted"
  meta?: SourceMeta;             // Only for kind: "source" (authors, year, venue, url, doi, filePath)
  edges: Edge[];                 // Connections to other Notes
  createdAt: string;
  updatedAt: string;
}
```

**6 kinds:** `source`, `finding`, `claim`, `question`, `method`, `insight`

**5 confidence levels:** `established > supported > hypothesized > questioned > refuted`

### Four Edge Types

```typescript
interface Edge {
  targetId: string;
  relation: EdgeRelation;        // "supports" | "contradicts" | "derived-from" | "relates-to"
  strength: EdgeStrength;        // "strong" | "moderate" | "weak"
  direction: "directed" | "mutual";
  context: string;               // WHY this connection exists (most important field)
}
```

| Relation | Direction | Meaning |
|----------|-----------|---------|
| `supports` | directed | A provides evidence for B |
| `contradicts` | mutual | A and B are in tension |
| `derived-from` | directed | A was produced from B (provenance) |
| `relates-to` | mutual | A and B are topically connected |

### Storage

Per-workspace only. `<workspace>/.open-research/ontology.json`. Global researcher identity stays in `~/.open-research/memory.json` (existing, unchanged).

### Concept Count: 21

1 node type, 6 kinds, 5 confidence levels, 4 edge relations, 3 edge strengths, 2 edge directions.

---

## Quality Safeguards

### Ontology Manager — Strict Edge Creation Rules

The ontology manager's system prompt includes precise rules to prevent hallucinated edges:

```
EDGE CREATION RULES — follow these exactly:

CONTRADICTS: Only when two findings make claims that CANNOT BOTH BE TRUE about
the same specific variable, measured in comparable conditions. Different metrics,
different populations, or different conditions are "relates-to", NOT "contradicts".
When uncertain, use "relates-to" with context explaining the difference.

SUPPORTS: Only when a finding provides DIRECT evidence for a claim. The finding
must actually test or measure the thing the claim asserts. Topical similarity
alone is NOT support — use "relates-to" instead.

DERIVED-FROM: Only for direct provenance. "This finding was extracted from this
paper." "This insight was synthesized from these specific findings." Not for
loose inspiration.

CONFIDENCE: Only change confidence based on EXPLICIT evidence in the conversation.
Do not infer confidence from tone or speculation. If uncertain, leave confidence
unchanged.

GENERAL: When in doubt, do NOT create the edge. A missing edge can be added later.
A wrong edge actively misleads the researcher.
```

### Relevance Agent — Semantic Matching

Replaces keyword matching in the scaffolding layer:

```
Relevance Agent (gpt-5.4-mini)
  Input: user message + compact note list (ID + first 60 chars + kind, ~100 notes max)
  Output: array of relevant note IDs (top 10-15)
  Latency: <1 second
```

Pre-filter before sending to relevance agent: if ontology has 500+ notes, first filter by kind or recency to get ~100 candidates, then send those to the agent for semantic selection.

### Write Serialization — No Race Conditions

The ontology manager runs in the background (non-blocking), but the user can send their next message immediately. Without protection, two concurrent managers could overwrite each other's changes.

**Solution:** A serial async queue. Each ontology manager invocation awaits the previous one before starting. Promise chaining in JS — no locks needed. Manager 2 always sees Manager 1's writes. The user never waits. See [02-agent-pipeline.md](./02-agent-pipeline.md) for the full implementation pattern.

Writes to `ontology.json` use temp-file-then-rename for crash safety (atomic on POSIX).

### User Correction

The user must be able to fix bad ontology state. Minimum commands:

```
/ontology                    — show ontology summary (note counts, contradictions, open questions)
/ontology claims             — list all claims with confidence + evidence count
/ontology conflicts          — list all contradiction pairs
/ontology around <term>      — show notes related to a topic with their edges
/ontology delete <id>        — remove a note and its edges
/ontology edit <id>          — update a note's content or confidence
```

These are code-level operations (no LLM needed). They give the user direct control over the ontology when the ontology manager gets something wrong.

---

## How the Ontology Builds

The researcher never manually builds the ontology. They just do research.

```
User: Read this paper and tell me the key findings
Agent: [reads PDF, extracts findings]
  → Ontology manager: 1 source + 3 findings + 3 derived-from edges

User: How does this compare to what Smith found?
Agent: [calls query_ontology, compares]
  → Ontology manager: 2 relates-to edges between findings

User: I think the contradiction is explained by dataset size differences
Agent: That's a reasonable hypothesis...
  → Ontology manager: 1 insight + 2 derived-from edges

User: Mark the efficiency claim as disputed given Chen's results
Agent: Updated.
  → Ontology manager: confidence → "questioned", adds contradicts edge
```

---

## How the Ontology Is Used

| Moment | What happens |
|--------|-------------|
| Agent is about to cite a paper | Scaffolding flags: "this paper has contradicting evidence" |
| User asks "write the methods section" | Agent calls `query_ontology` → gets all method notes → synthesizes |
| User asks "what should we read next?" | Agent calls `ontology_status` → sees gaps → targeted reading list |
| User makes a new claim | Ontology manager: no supports edges → next scaffolding flags it as unsupported |
| User asks "is our argument complete?" | Agent calls `ontology_status` → sees contradictions, gaps, open threads |

---

## Implementation Scope

### Files to Create

```
src/lib/ontology/
├── types.ts              — Note, Edge, Ontology type definitions
├── store.ts              — CRUD for ontology.json (load, save, atomic writes via temp+rename)
├── read-tools.ts         — get_note, search_notes, get_connections (shared)
├── write-tools.ts        — create_note, create_edge, etc. (ontology manager only)
├── manager.ts            — Ontology manager agent
├── manager-queue.ts      — Serial async queue (managers run one at a time, in order)
├── query-agent.ts        — Query agent
├── relevance-agent.ts    — Relevance agent for semantic scaffolding matching
├── scaffolding.ts        — Scaffolding layer (formats summary from relevant notes)
└── status.ts             — ontology_status (code function, no LLM)
```

### Files to Modify

```
src/lib/agent/runtime.ts         — Hook: relevance agent + scaffolding before turn, ontology manager after
src/lib/agent/tool-schemas.ts    — Add query_ontology + ontology_status definitions
src/lib/agent/tool-dispatcher.ts — Route query_ontology → query agent, ontology_status → code
src/tui/app.tsx                  — Add /ontology command family
```

### Files Unchanged

```
src/lib/memory/          — Global researcher identity stays as-is
src/lib/agent/tools/     — Existing research tools unaffected
```

---

## What This Is NOT

- **Not a user-facing visualization.** The ontology is invisible infrastructure. Users see its effects through better agent answers, not through a graph UI.
- **Not a generic graph.** The ontology is opinionated about research: sources, findings, claims, evidence chains.
- **Not a database.** JSON file per project. At 50-500 notes, this is simpler, portable, and human-readable.
- **Not replacing the memory system.** Global researcher identity stays in `memory.json`. The ontology is project-scoped evidence structure.

---

## Detailed Specs

| Document | What it covers |
|----------|---------------|
| [01-ontology-spec.md](./01-ontology-spec.md) | Full type definitions, edge semantics, confidence defaults, context field requirements |
| [02-agent-pipeline.md](./02-agent-pipeline.md) | Ontology manager: strict prompting rules, 9 tools, execution flow |
| [03-agent-usage-pipeline.md](./03-agent-usage-pipeline.md) | Relevance agent, scaffolding, query agent, concrete examples |
