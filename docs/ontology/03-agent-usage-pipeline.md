# Agent Usage Pipeline — How the Main Agent Reads the Ontology

## Overview

The main agent reads the ontology through two layers. It never writes — that's the ontology manager's job.

```
                    ┌─────────────────────────────────┐
                    │  RELEVANCE AGENT (gpt-5.4-mini)  │
                    │  Semantic matching: picks         │
                    │  relevant note IDs from compact   │
                    │  list. <1 second.                 │
                    └────────────┬────────────────────┘
                                 │ relevant note IDs
                                 ▼
                    ┌─────────────────────────────────┐
                    │  SCAFFOLDING LAYER (code)        │
                    │  Loads full notes for those IDs   │
                    │  Formats brief orientation summary│
                    │  Injects into main agent prompt   │
                    └────────────┬────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────┐
                    │  MAIN AGENT (gpt-5.4)           │
                    │  Sees scaffolding context        │
                    │  Calls query_ontology when       │
                    │  it needs deeper detail          │
                    └────────────┬────────────────────┘
                                 │ query_ontology("...")
                                 ▼
                    ┌─────────────────────────────────┐
                    │  QUERY AGENT (gpt-5.4-mini)     │
                    │  get_note, search_notes,         │
                    │  get_connections                  │
                    │  Traverses ontology, synthesizes │
                    │  answer, returns to main agent   │
                    └─────────────────────────────────┘
```

---

## Layer 1: Relevance Agent + Scaffolding

### Purpose

The scaffolding layer does NOT replace querying. It **orients** the main agent — tells it what exists in the ontology related to the user's request so it knows what to ask for. Without scaffolding, the main agent has no idea what's in the ontology and wouldn't know to call `query_ontology` at all.

Think of it as a table of contents, not the full book.

### Pre-filter: Skip Non-Research Messages

The relevance agent costs ~1 second + an API call. Don't waste it on messages that obviously aren't research:

```typescript
function shouldRunRelevanceAgent(message: string, ontology: Ontology): boolean {
  if (ontology.notes.length === 0) return false;     // Empty ontology — nothing to match
  if (message.startsWith("/")) return false;           // Slash commands
  if (message.length < 15) return false;               // "yes", "thanks", "ok"
  if (/^(hi|hello|hey|thanks|thank you|ok|yes|no)\b/i.test(message)) return false;
  return true;
}
```

When skipped, the scaffolding layer injects nothing. The main agent can still call `ontology_status` or `query_ontology` if it decides it needs ontology context.

### Step 1: Relevance Agent (Semantic Matching)

Keyword matching fails for research. "Computational complexity of self-attention" should match "quadratic scaling in dot-product attention" — but keyword overlap is near zero. The relevance agent uses gpt-5.4-mini to understand semantic meaning.

```
Relevance Agent (gpt-5.4-mini)

Input:
  - User message: "Write about the computational complexity of self-attention"
  - Note list: ID + full content + kind
    [abc123] "Transformers outperform RNNs on long-range dependency tasks" (claim)
    [def456] "Table 3: 12% BLEU improvement, p<0.01, on WMT14 EN-DE" (finding)
    [ghi789] "Quadratic scaling in dot-product attention limits sequence length" (finding)
    [jkl012] "Does efficiency hold for >100K tokens?" (question)
    ... (~100 notes max)

Output: ["abc123", "ghi789", "jkl012"]  — relevant note IDs

Latency: <1 second
```

Notes are typically 1-3 sentences — full content is fine to send. At 100 notes × ~150 chars each ≈ 4K tokens, well within gpt-5.4-mini's budget.

**System prompt:**
```
You receive a user's research message and a list of notes from their ontology.
Return the IDs of notes that are SEMANTICALLY relevant to the user's message.
Consider synonyms, related concepts, and implied topics — not just keyword matches.
Return 10-15 IDs maximum. Return an empty array if nothing is relevant.
```

**Scale handling:** If the ontology has 500+ notes, pre-filter by kind or recency to get ~100 candidates, then send those to the relevance agent.

### Step 2: Scaffolding (Code, Instant)

Takes the relevant note IDs from the relevance agent, loads the full notes, and formats a brief summary.

```
## Ontology Context

Your project ontology contains the following related to this topic:

- CLAIM: "Transformers outperform RNNs on long-range tasks" (supported, 3 supporting, 1 contradicting)
- CLAIM: "Attention is quadratic in sequence length" (established, 2 supporting)
- 4 findings from Smith 2024, Chen 2023, Park 2025
- 1 open question about low-resource language generalization
- 1 contradiction between Smith 2024 and Chen 2023

⚠ There is contradicting evidence on the efficiency claim.

Use query_ontology to get full details on any of the above.
```

This is ~300-500 tokens. It tells the agent:
- What claims, findings, and sources exist on this topic
- Where contradictions and gaps are
- That it should use `query_ontology` to get the actual detail

### What Scaffolding Does NOT Do

- Does NOT provide full evidence chains (that's the query agent's job)
- Does NOT provide full note content (too expensive for scaffolding)
- Does NOT replace the need to query — it makes querying smarter

### How It Works

```typescript
// Step 1: Relevance agent picks note IDs
const relevantIds = await runRelevanceAgent(ontology, userMessage);

// Step 2: Code formats the summary
function buildScaffoldingContext(
  ontology: Ontology,
  relevantIds: string[]
): string | null {
  if (relevantIds.length === 0) return null;
  // 1. Load full notes for each ID
  // 2. Group by kind: claims, findings, sources, questions
  // 3. For claims: include confidence + count of supports/contradicts edges
  // 4. Flag contradictions and unsupported claims as ⚠ alerts
  // 5. Format as brief summary (~300-500 tokens)
}
```

### When It Adds Nothing

If the user's message doesn't match anything in the ontology (e.g., "hello", "/config theme dark", or a topic not yet in the ontology), the scaffolding layer injects nothing. The main agent can still call `ontology_status` to get a high-level overview if it wants to.

---

## Layer 2: Query Agent (Active, LLM-Powered)

### Purpose

When the main agent needs **actual detail** from the ontology — full evidence chains, specific findings, source comparisons — it calls `query_ontology`. This dispatches to a dedicated query agent that reads the ontology deeply and returns a synthesized answer.

### Why a Separate Agent

The main agent shouldn't parse raw graph data. It should ask a question and get an informed answer. The query agent:

- Has the same read tools as the ontology manager (`get_note`, `search_notes`, `get_connections`)
- Can make multiple read calls to traverse the ontology intelligently
- Synthesizes the results into a clear, natural language conclusion
- Returns that conclusion as the tool output to the main agent

### How Search Works Inside the Query Agent

`search_notes` combines **structural filters** (kind, confidence, edge presence/absence) with **BM25 text ranking**. Most researcher questions are structural — the query agent picks the right approach:

```
"What claims have no evidence?"
  → search_notes({ kind: "claim", missingEdge: "supports" })
  → Pure structural filter. No text search. Instant.

"What contradicts our efficiency claim?"
  → search_notes({ queries: ["efficiency"], kind: "claim" })
  → BM25 finds the claim, then get_connections traverses contradicts edges.

"Anything about attention mechanisms?"
  → search_notes({ queries: ["attention mechanism", "self-attention", "dot-product"] })
  → BM25 ranks candidates across all phrasings in one call.
```

Text search is the **fallback**, not the primary path. Most queries either start from a known node (via scaffolding) or use structural filters. The LLM is the semantic layer — it picks the right phrasings for BM25 and follows edges to discover notes that keyword search would miss. See [02-agent-pipeline.md](./02-agent-pipeline.md#search_notes--implementation-detail) for the full implementation.

### Main Agent's Tools

The main agent has exactly 2 ontology-related tools:

#### `query_ontology`

```typescript
query_ontology: {
  query: string;         // Natural language: "what contradicts the efficiency claim"
  scope?: string;        // Optional: "claims", "sources", "questions", "methods", "findings", "insights"
}
```

When the main agent calls this, the query agent runs:

```
Main Agent calls: query_ontology("what contradicts our efficiency claim")
        │
        ▼
Query Agent (gpt-5.4-mini) starts
        │
        ├─ search_notes({ queries: ["efficiency claim", "scaling performance"], kind: "claim" })
        │   → BM25 ranks candidates, finds claim node [id: abc123]
        │
        ├─ get_connections("abc123", depth: 2)
        │   → sees: 3 supports edges, 1 contradicts edge
        │   → contradicting note: [id: def456]
        │
        ├─ get_note("def456")
        │   → "Opposite scaling at 10x data" from Chen 2023
        │   → edge context: "Suggests finding is dataset-size-dependent"
        │
        ▼
Returns to Main Agent:
  "Chen 2023 (Section 5) found opposite scaling behavior when training
   data was increased 10x, contradicting the efficiency claim with moderate
   strength. The edge context notes this suggests the original finding may
   be dataset-size-dependent. The claim currently has 3 supporting findings
   (Smith 2024, Park 2025, your experiment #3) and this 1 contradiction."
```

The main agent receives a synthesized paragraph, not raw node data.

#### `ontology_status`

```typescript
ontology_status: {}
```

Returns a high-level overview (no query agent needed — this is a simple code function):

```
Ontology: 47 notes
  Sources: 8
  Findings: 19
  Claims: 7 (2 unsupported, 1 refuted)
  Questions: 5
  Methods: 3
  Insights: 5

Contradictions: 3
Unsupported claims: 2
Open questions: 5
```

### Query Agent Detail

**Model:** gpt-5.4-mini (fast, cheap — it's just reading and summarizing, not doing complex research reasoning)

**System prompt:**
```
You are an ontology query agent. You receive a research question and
have tools to read a project ontology. Your job:

1. Choose the right search strategy:
   - Structural queries ("unsupported claims", "open questions"): use filters (kind, missingEdge)
   - Specific entities ("Smith 2024", "efficiency claim"): use text queries + kind filter
   - Broad topics ("attention mechanisms"): use multiple synonym phrases in queries
2. Use get_connections to traverse from found nodes — follow edges to discover related notes
3. Use get_note to read full details when needed
4. Synthesize your findings into a clear, informative answer

Be thorough but concise. Include specific evidence, sources, and confidence
levels. If you find contradictions, explain both sides. If information is
missing, say so explicitly.
```

**Tools:** `get_note`, `search_notes`, `get_connections` (same read tools as ontology manager)

**Typical execution:** 2-4 read tool calls, ~1-2 seconds, returns a 100-300 word synthesis

---

## How the Two Layers Work Together

### Example: User says "Write the efficiency section of our paper"

**1. Scaffolding fires (code, instant):**
```
Ontology Context:
- CLAIM: "Transformers outperform RNNs on long-range tasks" (supported, 3 supporting, 1 contradicting)
- 4 findings from 3 sources related to efficiency
- ⚠ Contradicting evidence exists on the efficiency claim
Use query_ontology to get full details.
```

**2. Main agent starts reasoning:**
- Sees the scaffolding — knows there's a claim with contradicting evidence
- Calls `query_ontology("full evidence for the transformer efficiency claim")`

**3. Query agent runs:**
- `search_notes({ queries: ["transformer efficiency", "attention cost"], kind: "claim" })` → finds the claim
- `get_connections(claimId, depth: 2)` → gets all supports + contradicts
- `get_note` on each connected finding → reads full details
- Returns: "The claim has 3 supporting findings: Smith 2024 Table 3 (12% BLEU improvement), Park 2025 Table 5 (linear attention matches quadratic up to 50K), your experiment #3. One contradiction: Chen 2023 Section 5 found opposite scaling at 10x data. The contradiction context suggests dataset-size dependency as the likely explanation."

**4. Main agent writes the section** with proper evidence, addressing the contradiction.

**5. Main agent realizes it needs methodology details:**
- Calls `query_ontology("methods used across the efficiency studies", scope: "methods")`
- Query agent traverses, returns methodology comparison
- Main agent uses this to explain why results differ

**Result:** A well-evidenced section that the main agent couldn't have written from scaffolding alone. The scaffolding told it what to ask for. The query agent gave it the real answers.

### Example: User says "What should we investigate next?"

**1. Scaffolding fires:** broad query, injects brief summary of ontology shape

**2. Main agent:**
- Calls `ontology_status()` → gets the full picture (code function, no LLM)
- Sees: 2 unsupported claims, 3 contradictions, 5 open questions
- Calls `query_ontology("unsupported claims that need evidence")`
- Query agent returns the 2 claims with details on what evidence would strengthen them
- Calls `query_ontology("open questions ranked by importance")`
- Query agent returns prioritized questions with connections to existing claims

**3. Main agent synthesizes** a concrete research agenda from the query results.

---

## What the Main Agent Does NOT Do

- **Never writes to the ontology** — ontology manager handles all mutations
- **Never sees node IDs** — it works in natural language, query agent handles ontology traversal
- **Never parses ontology structure** — it receives synthesized English answers from the query agent
- **Never needs to know it's using an ontology** — from its perspective, it has a "research knowledge base" it can ask questions about

---

## Implementation — Files

| File | Role |
|------|------|
| `src/lib/ontology/relevance-agent.ts` | Relevance agent: semantic note matching, returns relevant IDs |
| `src/lib/ontology/scaffolding.ts` | Scaffolding layer: loads notes by ID, formats brief summary |
| `src/lib/ontology/query-agent.ts` | Query agent: system prompt, read tool routing, synthesis |
| `src/lib/ontology/read-tools.ts` | Shared read tools: get_note, search_notes, get_connections |
| `src/lib/ontology/status.ts` | ontology_status implementation (code, no LLM) |
| `src/lib/agent/tool-schemas.ts` | Add query_ontology + ontology_status tool definitions |
| `src/lib/agent/tool-dispatcher.ts` | Route query_ontology → query agent, ontology_status → code function |
| `src/lib/agent/runtime.ts` | Hook: relevance agent + scaffolding before turn, ontology manager after |
