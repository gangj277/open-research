# Ontology Manager — Ontology Write Pipeline

## Architecture

Three agents, three concerns:

```
User sends message
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SCAFFOLDING LAYER (code, no LLM)                                   │
│  Queries ontology for relevant context based on user's message      │
│  Injects summary into main agent's system prompt                    │
│  Purpose: orient the main agent on what exists so it queries better │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN AGENT (gpt-5.4)                                               │
│  Research tools: read_file, run_command, fetch_url, etc.            │
│  Ontology tools: query_ontology, ontology_status                    │
│  When it calls query_ontology →                                     │
│      ┌──────────────────────────────────────┐                       │
│      │  QUERY AGENT (gpt-5.4-mini)          │                       │
│      │  Read tools: get_note, search_notes, │                       │
│      │  get_connections                      │                       │
│      │  Returns synthesized answer           │                       │
│      └──────────────────────────────────────┘                       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
              Main agent turn FULLY COMPLETE
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ONTOLOGY MANAGER (gpt-5.4, background, non-blocking)               │
│  Read tools: get_note, search_notes, get_connections                │
│  Write tools: create_note, create_edge, update_note, update_edge,  │
│               remove_edge, merge_notes                              │
│  Receives full turn context → updates ontology.json                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Ontology Manager — Detail

### When It Runs

Once, after the **entire agent response is finalized** — meaning the main agent has finished all its internal tool-call loops, produced its final text output, and the turn is fully complete. NOT after each internal iteration (tool call → result → next tool call).

Non-blocking — the user can start typing the next message while the ontology manager works in the background.

### Write Serialization — Preventing Race Conditions

The ontology manager runs in the background, but the user can send their next message immediately. This creates a race condition: if Turn 2 completes before Turn 1's ontology manager finishes writing, Turn 2's manager could overwrite Turn 1's changes.

**Solution: Serial async queue.** Each ontology manager invocation awaits the previous one before starting. JavaScript is single-threaded, so no locks or mutexes are needed — just Promise chaining.

```typescript
// src/lib/ontology/manager-queue.ts

let pendingWrite: Promise<void> = Promise.resolve();

/**
 * Enqueue an ontology manager run. Each run waits for the previous
 * one to complete before starting. The caller does NOT await — the
 * queue runs in the background.
 *
 * If a queued run fails, the error is swallowed (best-effort) and
 * the next run proceeds normally.
 */
export function enqueueOntologyManager(input: OntologyManagerInput): void {
  pendingWrite = pendingWrite
    .then(() => runOntologyManager(input))
    .catch(() => { /* best-effort — log error, don't block queue */ });
}
```

**How it works:**

```
Turn 1 completes → enqueueOntologyManager(turn1)
  pendingWrite = resolved.then(() => runOntologyManager(turn1))
  Manager 1 starts immediately, reads ontology.json, makes writes

Turn 2 completes → enqueueOntologyManager(turn2)
  pendingWrite = [manager1 promise].then(() => runOntologyManager(turn2))
  Manager 2 is QUEUED — does not start until Manager 1's promise resolves

Manager 1 finishes → ontology.json updated with Turn 1's changes
Manager 2 starts → reads ontology.json (now includes Turn 1's changes) → writes Turn 2's changes

Turn 3 completes → enqueueOntologyManager(turn3)
  pendingWrite = [manager2 promise].then(() => runOntologyManager(turn3))
  Manager 3 queued behind Manager 2
```

**Properties:**
- **Serialized:** Managers run one at a time, in order. No lost updates.
- **Non-blocking to the user:** `enqueueOntologyManager` returns immediately. The user never waits.
- **No locks needed:** JS event loop is single-threaded. Promise chaining is sufficient.
- **Fault-tolerant:** `.catch()` prevents a failed run from blocking the queue. If Manager 1 crashes, Manager 2 still runs.
- **Ordered:** Turns are processed in the order they completed. Turn 2's manager always sees Turn 1's writes.

**Scaffolding reads are unaffected.** The scaffolding layer reads ontology.json at the start of each turn. If a previous manager hasn't finished writing yet, scaffolding sees slightly stale data — this is acceptable. Scaffolding is orientation, not authoritative. The query agent (called mid-turn) may also see stale data for the same reason, but this is a minor issue: the data is at most one turn behind, and the ontology manager will catch up.

### Atomic Writes — Crash Safety

Each ontology manager write uses temp-file-then-rename to prevent corruption if the process is killed mid-write:

```typescript
// src/lib/ontology/store.ts

export async function saveOntology(
  ontology: Ontology,
  workspaceDir: string
): Promise<void> {
  const filePath = path.join(workspaceDir, ".open-research", "ontology.json");
  const tmpPath = filePath + ".tmp";
  
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(ontology, null, 2));
  await fs.rename(tmpPath, filePath);  // Atomic on POSIX
}
```

If the process crashes between `writeFile` and `rename`, the `.tmp` file is left behind and the original `ontology.json` is untouched. On next startup, clean up any stale `.tmp` files.

### What It Receives

```typescript
interface OntologyManagerInput {
  // The complete interaction that just happened
  userMessage: string;
  agentResponse: string;
  toolOutputs: Array<{ tool: string; input: string; output: string }>;
  
  // Context
  sessionId: string;
  turnIndex: number;
}
```

Note: the ontology manager does NOT receive a pre-built ontology summary as input. It has read tools (`get_note`, `search_notes`, `get_connections`) to inspect the ontology itself. This means it can look up exactly what it needs, not rely on a possibly incomplete summary.

### Its System Prompt

```
You are the Ontology Manager for a research ontology.

Your job: after each research conversation turn, extract structured knowledge
and update the ontology. You have read tools to inspect the current ontology and
write tools to modify it.

GENERAL RULES:
- Only create nodes for SUBSTANTIVE knowledge — not chitchat, not commands, not UI interactions.
- Before creating a node, use search_notes to check if a similar one already exists.
  If it does, update it or create an edge to it — don't duplicate.
- Every finding MUST have a derived-from edge to its source. Use get_note or search_notes
  to find the source node first.
- Use get_connections to understand a node's neighborhood before modifying it.
- Context on edges must explain WHY the connection exists, not just repeat the relation type.
- Be conservative. 1-5 ontology operations per turn is normal. 0 is fine if nothing substantive happened.
- When in doubt, do NOT create the edge. A missing edge can be added later. A wrong edge
  actively misleads the researcher.

EDGE CREATION RULES — follow these exactly:

CONTRADICTS: Only create when two findings make claims that CANNOT BOTH BE TRUE about
the same specific variable, measured in comparable conditions. Different metrics,
different populations, or different conditions are "relates-to", NOT "contradicts".
When uncertain whether something is a contradiction or just a different angle,
use "relates-to" with context explaining the difference.

SUPPORTS: Only create when a finding provides DIRECT evidence for a claim. The finding
must actually test or measure the thing the claim asserts. Topical similarity alone
is NOT support — use "relates-to" instead.

DERIVED-FROM: Only for direct provenance. "This finding was extracted from this paper."
"This insight was synthesized from these specific findings." Not for loose inspiration
or topical similarity.

RELATES-TO: The catch-all for genuine topical connections that don't fit the above three.
Prefer this over a wrong "supports" or "contradicts" edge.

CONFIDENCE RULES:
- Only change confidence based on EXPLICIT evidence in the conversation.
- Do not infer confidence from tone, speculation, or assumptions.
- If uncertain about the right confidence level, leave it unchanged.
- Default: findings → "established", claims → "hypothesized", insights → "hypothesized".
```

### Its Tools

```typescript
// ── Read (shared with Query Agent) ──────────────────────────────────

get_note: {
  noteId: string;
}
// Returns: full Note object (content, kind, confidence, edges, meta)

search_notes: {
  queries?: string[];        // Text search phrases (OR logic) — optional, can filter without text
  kind?: NoteKind;           // Filter by kind
  confidence?: Confidence;   // Filter by confidence level
  hasEdge?: EdgeRelation;    // Must have at least one edge of this relation type
  missingEdge?: EdgeRelation;// Must NOT have any edges of this relation type
  limit?: number;            // Max results (default: 10)
}
// Returns: array of matching Notes with their edges
// At least one of queries/kind/confidence/hasEdge/missingEdge must be provided

get_connections: {
  noteId: string;
  depth?: number;            // How many hops to traverse (default: 1, max: 3)
}
// Returns: the note + all connected notes within N hops, with edges

// ── Write (ontology manager only) ───────────────────────────────────

create_note: {
  content: string;
  kind: NoteKind;            // "source" | "finding" | "claim" | "question" | "method" | "insight"
  confidence: Confidence;    // "established" | "supported" | "hypothesized" | "questioned" | "refuted"
  meta?: SourceMeta;         // Only for kind: "source"
}
// Returns: { noteId: string }

create_edge: {
  sourceNoteId: string;      // FROM
  targetNoteId: string;      // TO
  relation: EdgeRelation;    // "supports" | "contradicts" | "derived-from" | "relates-to"
  strength: EdgeStrength;    // "strong" | "moderate" | "weak"
  direction: "directed" | "mutual";
  context: string;           // WHY this connection exists
}
// Returns: { edgeId: string }

update_note: {
  noteId: string;
  content?: string;
  confidence?: Confidence;
}
// Returns: { updated: true }

update_edge: {
  sourceNoteId: string;
  targetNoteId: string;
  relation: EdgeRelation;    // Identifies which edge
  strength?: EdgeStrength;
  context?: string;
}
// Returns: { updated: true }

remove_edge: {
  sourceNoteId: string;
  targetNoteId: string;
  relation: EdgeRelation;
}
// Returns: { removed: true }

merge_notes: {
  keepNoteId: string;
  removeNoteId: string;
  mergedContent?: string;
}
// All edges pointing to removeNoteId get redirected to keepNoteId.
// Returns: { merged: true, edgesRedirected: number }
```

9 tools total (3 read, 6 write). The ontology manager runs as a standard tool-use agent loop — it reads the ontology to understand current state, then makes targeted writes.

### `search_notes` — Implementation Detail

`search_notes` is the most critical read tool. Both the ontology manager (for dedup) and the query agent (for retrieval) depend on it.

#### First Principle: Why Search Exists

Search has exactly one job: **find a starting node when you don't already have one.** Once you have any entry point into the graph, everything else is traversal via `get_connections`. Most researcher questions are actually structural — "what contradicts X?", "what's unsupported?", "what came from this paper?" — and those are answered by edge traversal and filters, not text search.

This means `search_notes` combines two capabilities:
1. **Structural filters** — narrow by kind, confidence, edge presence/absence (instant, deterministic)
2. **BM25 text ranking** — rank remaining candidates by text relevance (fast, ~50 lines of code)

The LLM agent picks the right combination per query. Structural queries skip text search entirely.

#### How the Agent Uses Search

```
"What contradicts our efficiency claim?"
  → search_notes({ queries: ["efficiency"], kind: "claim" })     — find the claim
  → get_connections(claimId)                                      — traverse contradicts edges
  → No text search needed for the actual answer

"What claims have no evidence?"
  → search_notes({ kind: "claim", missingEdge: "supports" })     — pure structural, no text
  → Done. No BM25 needed at all.

"Anything about attention mechanisms?"
  → search_notes({ queries: ["attention mechanism", "self-attention", "dot-product attention"] })
  → BM25 ranks candidates, agent explores from best matches

"Findings from Smith 2024"
  → search_notes({ queries: ["Smith 2024"], kind: "source" })    — find source by metadata
  → get_connections(sourceId)                                     — traverse derived-from edges
```

#### Algorithm: Structural Filter + BM25 Scoring

```typescript
// src/lib/ontology/read-tools.ts

interface SearchParams {
  queries?: string[];
  kind?: NoteKind;
  confidence?: Confidence;
  hasEdge?: EdgeRelation;
  missingEdge?: EdgeRelation;
  limit?: number;
}

function searchNotes(ontology: Ontology, params: SearchParams): Note[] {
  const { queries, kind, confidence, hasEdge, missingEdge, limit = 10 } = params;

  // ── Phase 1: Structural filters (instant, deterministic) ──────────

  let candidates = ontology.notes;

  if (kind) {
    candidates = candidates.filter(n => n.kind === kind);
  }
  if (confidence) {
    candidates = candidates.filter(n => n.confidence === confidence);
  }
  if (hasEdge) {
    candidates = candidates.filter(n =>
      n.edges.some(e => e.relation === hasEdge) ||
      // Check reverse: other notes with mutual edges pointing to this note
      ontology.notes.some(other =>
        other.edges.some(e =>
          e.targetId === n.id && e.relation === hasEdge && e.direction === "mutual"
        )
      )
    );
  }
  if (missingEdge) {
    candidates = candidates.filter(n =>
      !n.edges.some(e => e.relation === missingEdge) &&
      !ontology.notes.some(other =>
        other.edges.some(e =>
          e.targetId === n.id && e.relation === missingEdge && e.direction === "mutual"
        )
      )
    );
  }

  // ── Phase 2: BM25 text ranking (only if queries provided) ────────

  if (!queries || queries.length === 0) {
    // No text search — return filtered candidates by recency
    return candidates
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  // Tokenize all query phrases
  const queryTokenSets = queries.map(q => tokenize(q));

  // Precompute corpus stats for BM25
  const avgDocLen = candidates.reduce((sum, n) => sum + tokenize(n.content).length, 0)
    / Math.max(candidates.length, 1);
  const N = candidates.length;

  // Build document frequency map: token → how many candidates contain it
  const df = new Map<string, number>();
  for (const note of candidates) {
    const uniqueTokens = new Set(tokenize(note.content));
    for (const token of uniqueTokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  // BM25 parameters
  const k1 = 1.2;   // Term frequency saturation
  const b = 0.75;    // Length normalization

  const scored = candidates.map(note => {
    const noteTokens = tokenize(note.content);
    const docLen = noteTokens.length;

    // Count term frequencies in this note
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
        const tfNorm = (termFreq * (k1 + 1))
          / (termFreq + k1 * (1 - b + b * docLen / avgDocLen));

        score += idf * tfNorm;
      }
      bestBM25 = Math.max(bestBM25, score);
    }

    // Source metadata bonus: match against authors, year, venue
    let metaBonus = 0;
    if (note.kind === "source" && note.meta) {
      const metaText = [note.meta.authors, note.meta.venue, note.meta.year?.toString()]
        .filter(Boolean).join(" ");
      const metaTokens = new Set(tokenize(metaText));
      for (const queryTokens of queryTokenSets) {
        const metaHits = queryTokens.filter(qt => metaTokens.has(qt)).length;
        metaBonus = Math.max(metaBonus, metaHits * 0.5);
      }
    }

    return { note, score: bestBM25 + metaBonus };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.note);
}
```

#### Why BM25 Over Simple Word Overlap

BM25 is the ranking algorithm behind Elasticsearch and Lucene. Three properties that matter for research notes:

| Property | What it does | Why it matters |
|----------|-------------|----------------|
| **IDF** (Inverse Document Frequency) | Rare terms score higher than common ones | "quadratic" in 3/200 notes is a strong signal. "model" in 150/200 is noise. Word overlap treats them equally. |
| **TF saturation** | First occurrence matters most, diminishing returns after | A note mentioning "efficiency" 10 times isn't 10x more relevant than one mentioning it once. Word overlap can't express this. |
| **Length normalization** | Short documents that match score higher | A 20-word finding that matches is more relevant than a 200-word insight that mentions the term in passing. Word overlap ignores document length. |

Zero dependencies, ~50 lines, <1ms for 500 notes. Still keyword-based — the LLM agent handles semantic understanding via multi-query synonyms and graph traversal.

#### Source Dedup: Identity Match, Not Text Search

For sources specifically, dedup doesn't need text search at all — match on structured identity:

```typescript
function findExistingSource(ontology: Ontology, meta: SourceMeta): Note | null {
  return ontology.notes.find(n => {
    if (n.kind !== "source" || !n.meta) return false;
    if (meta.doi && n.meta.doi && meta.doi === n.meta.doi) return true;
    if (meta.url && n.meta.url && meta.url === n.meta.url) return true;
    if (meta.authors && meta.year && n.meta.authors && n.meta.year) {
      return normalizeTitle(n.content) === normalizeTitle(meta.authors)
        && n.meta.year === meta.year;
    }
    return false;
  });
}
```

#### The Four Layers of "Search"

No single algorithm makes search smart. The system is smart because four layers compensate for each other:

| Layer | What it does | Handles |
|-------|-------------|---------|
| **Structural filters** | Kind, confidence, edge presence/absence | "Unsupported claims", "all questions", "findings without sources" |
| **Identity matching** | DOI, URL, author+year for sources | Exact dedup without any text matching |
| **BM25 text ranking** | IDF + TF saturation + length normalization | "Anything about attention mechanisms?" |
| **LLM + graph traversal** | Agent reformulates queries, follows edges from entry points | Semantic understanding, discovering related notes search would miss |

Text search is the fallback, not the primary path. Most queries either start from a known node (via scaffolding) or use structural filters.

**Scale:** At 50-500 notes, BM25 scoring on every note is <1ms. No index needed. If the ontology grows past ~2000 notes, add an inverted index (token → noteId set) as a precomputed lookup table — same BM25 scoring, just faster candidate retrieval.

### Typical Ontology Manager Turn

```
1. Receives: user asked about transformer efficiency, agent searched 3 papers,
   found results, wrote a summary

2. Calls search_notes({ queries: ["transformer efficiency", "attention scaling"], kind: "claim" }) → finds existing claim node

3. Calls get_connections(claimId) → sees current supports/contradicts edges

4. Agent response mentioned a new paper (Park 2025) not in ontology yet:
   - Calls create_note(kind: "source", content: "Park 2025 — Efficient Attention at Scale")
   - Calls create_note(kind: "finding", content: "Linear attention matches quadratic up to 50K tokens")
   - Calls create_edge(finding → source, relation: "derived-from", context: "Extracted from Table 5...")
   - Calls create_edge(finding → claim, relation: "supports", context: "Confirms efficiency at moderate scale...")

5. Done. 4 write operations. Ontology updated.
```

## Execution Flow — One Complete Interaction

```
1. User sends message

2. Scaffolding layer (code, no LLM):
   a. Query ontology for nodes relevant to user's message
   b. Format as brief orientation context
   c. Inject into main agent's system prompt
   d. Purpose: help the main agent know what to query, not replace querying

3. Main agent runs:
   a. Sees scaffolding context — knows what exists in the ontology
   b. Does research (read_file, search, fetch_url, etc.)
   c. Calls query_ontology when it needs ontology details → Query Agent runs, returns answer
   d. Produces final response
   e. All tool calls and results collected

4. Main agent turn FULLY COMPLETE — user sees the final response

5. Ontology manager runs (background, non-blocking):
   a. Receives: user message + all tool calls/results + final agent response
   b. Uses read tools to inspect current ontology state
   c. Uses write tools to update: create_note, create_edge, update_note, etc.
   d. ontology.json updated on disk
```

## Implementation — Files

| File | Role |
|------|------|
| `src/lib/ontology/types.ts` | Note, Edge, Ontology types (from ontology spec) |
| `src/lib/ontology/store.ts` | CRUD for ontology.json — load, save (atomic writes via temp+rename) |
| `src/lib/ontology/read-tools.ts` | Read tool implementations: get_note, search_notes, get_connections (shared) |
| `src/lib/ontology/write-tools.ts` | Write tool implementations: create_note, create_edge, etc. (manager only) |
| `src/lib/ontology/manager.ts` | Ontology manager agent — system prompt, tool routing, execution |
| `src/lib/ontology/manager-queue.ts` | Serial async queue — ensures managers run one at a time, in order |
| `src/lib/agent/runtime.ts` | Hook: calls `enqueueOntologyManager()` after turn completes |

The `src/lib/memory/` directory continues to exist for **global** researcher identity (user preferences, methodology habits — persists across all projects). The ontology lives in `src/lib/ontology/` and is **per-workspace only** — each research project builds its own ontology in `<workspace>/.open-research/ontology.json`.

## Cost

The ontology manager runs on gpt-5.4 to ensure high-quality ontology operations — accurate edge creation, correct confidence assessment, and meaningful context strings. Ontology quality is critical; a cheap model producing bad edges is worse than no ontology at all.

- Input: ~2000-3000 tokens (system prompt + turn context + read tool results)
- Output: ~300-500 tokens (read calls + write calls)
- Latency: ~3-5 seconds, non-blocking (user doesn't wait)
