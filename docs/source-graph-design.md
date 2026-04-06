# Source Graph — Evolving Memory into a Research Knowledge Base

## The Idea

Don't build a separate "knowledge graph" feature. Evolve the existing memory system so that every memory the agent creates is a structured node with source attribution and connections to other nodes. The memory store becomes a project-scoped source graph — a second brain that grows through conversation.

## What Exists Today

```typescript
interface Memory {
  id: string;
  content: string;               // flat text, no structure
  category: "user" | "preference" | "project" | "methodology" | "context";
  scope: "global" | "project";
  createdAt: string;
  lastRelevantAt: string;
  relevanceCount: number;
}
```

**What's good:** project scoping, LLM extraction after each turn, relevance scoring, persistence, agent prompt injection, TUI commands. All reusable.

**What's missing:** no source attribution, no connections, no claim structure, no evidence tracking.

## Proposed Evolution

### New Memory Node Type

```typescript
interface MemoryNode {
  id: string;
  
  // ── What it is ──
  type: "claim" | "finding" | "source" | "question" | "method" | "insight" | "decision";
  content: string;                    // human-readable summary
  confidence: "high" | "medium" | "low" | "disputed";
  
  // ── Where it came from ──
  origin: {
    kind: "agent" | "user" | "paper" | "url" | "observation";
    sourceId?: string;                // links to another MemoryNode of type "source"
    citation?: string;                // "Smith et al. 2024, Table 3"
    sessionId?: string;               // which conversation produced this
    turnIndex?: number;               // which turn in that conversation
  };
  
  // ── How it connects ──
  edges: Array<{
    targetId: string;                 // ID of another MemoryNode
    relation: "supports" | "contradicts" | "derives-from" | "questions" | "refines" | "cites";
    strength: "strong" | "moderate" | "weak";
    note?: string;                    // why this connection exists
  }>;
  
  // ── Existing fields (backward compatible) ──
  category: "user" | "preference" | "project" | "methodology" | "context";
  scope: "global" | "project";
  createdAt: string;
  lastRelevantAt: string;
  relevanceCount: number;
}
```

### Why These Node Types

| Type | What it captures | Example |
|------|-----------------|---------|
| `claim` | An assertion that needs evidence | "Transformer models outperform RNNs on long-range dependencies" |
| `finding` | A specific result from a source | "Table 3 shows 12% improvement in BLEU score (p<0.01)" |
| `source` | A paper, URL, or document | "Vaswani et al. 2017, Attention Is All You Need" |
| `question` | An open research question | "Does this hold for low-resource languages?" |
| `method` | A methodology or approach | "Used 5-fold cross-validation with stratified sampling" |
| `insight` | A synthesis or connection the user/agent made | "The contradiction between Smith and Jones might be explained by different dataset sizes" |
| `decision` | A research decision and its rationale | "Chose to exclude papers before 2020 because the architecture changed fundamentally" |

### Why These Edge Types

| Relation | Meaning | Example |
|----------|---------|---------|
| `supports` | Evidence for a claim | Finding → Claim: "Table 3 results support the efficiency claim" |
| `contradicts` | Counter-evidence | Finding → Claim: "But Chen 2023 shows opposite result" |
| `derives-from` | Built on top of | Insight → Finding: "This synthesis comes from combining these two findings" |
| `questions` | Raises doubt about | Question → Claim: "Does this generalize beyond English?" |
| `refines` | Narrows or updates | Claim → Claim: "Updated after reading newer paper" |
| `cites` | References a source | Claim → Source: "According to Vaswani 2017" |

## How It Builds Through Conversation

### Automatic Extraction (evolve existing extractor)

The current extractor (`src/lib/memory/extractor.ts`) calls the LLM after each turn with the conversation snippet. Today it outputs `{ action, content, category }`. Evolve it to output:

```typescript
interface ExtractionAction {
  action: "create" | "update" | "connect";
  
  // For "create":
  type?: MemoryNode["type"];
  content?: string;
  confidence?: MemoryNode["confidence"];
  origin?: Partial<MemoryNode["origin"]>;
  connectTo?: Array<{
    targetId: string;
    relation: string;
    strength: string;
  }>;
  
  // For "update":
  updateId?: string;
  newConfidence?: string;
  
  // For "connect":
  sourceId?: string;
  targetId?: string;
  relation?: string;
  strength?: string;
  note?: string;
}
```

The extraction prompt tells the LLM: "Given this exchange, identify any new claims, findings, sources, questions, insights, or decisions. For each, note what it connects to in existing knowledge."

The LLM sees the existing graph summary (injected into prompt) and can reference existing node IDs.

### User-Driven Creation

Users can explicitly create/connect nodes:

```
> This paper contradicts what we found in Smith 2024
  Agent: I'll note that. [creates "contradicts" edge between the new source and the existing Smith finding]

> I think the real explanation is dataset size differences
  Agent: Good insight. [creates "insight" node, connects to both contradicting findings with "derives-from"]

> Mark the transformer efficiency claim as disputed
  Agent: Updated confidence to "disputed" for that claim.
```

No special syntax needed — the agent infers graph operations from natural language, same as it infers tool calls today.

## How It Surfaces

### 1. Proactive Conflict Detection

When the agent encounters a new finding, it checks the graph for contradictions:

> "You're citing Lee 2024 to support the efficiency claim, but I have a finding from Chen 2023 (node #47) that shows the opposite result with a larger dataset. Want me to compare them?"

This is the killer feature. It happens automatically by querying the graph during agent turns.

### 2. Evidence Audit

User asks: "What's the evidence for our main claim?"

Agent traverses the graph from the claim node, follows `supports` and `contradicts` edges, and produces:

```
Claim: "Transformers outperform RNNs on long-range tasks" (medium confidence)

Supporting:
  ├── Vaswani 2017, Table 2 (strong)
  ├── Your experiment run #3, accuracy comparison (moderate)
  └── Brown 2020, Section 4.1 (strong)

Contradicting:
  └── Chen 2023, low-resource results (moderate)

Open questions:
  └── "Does this hold for languages with different word order?" (node #52)
```

### 3. Memory-Augmented System Prompt

Today, `formatMemoriesForPrompt()` injects flat text. Evolve it to inject structured context:

```
## Your Research Knowledge Graph

### Key Claims (3)
- [C1] Transformers outperform RNNs on long-range tasks (medium, 3 supporting, 1 contradicting)
- [C2] Attention mechanisms are computationally quadratic (high, 2 supporting)
- [C3] Flash attention reduces memory to linear (high, 1 supporting)

### Recent Findings (2)
- [F7] Chen 2023 shows opposite result for low-resource → contradicts [C1]
- [F8] Your experiment confirms quadratic scaling → supports [C2]

### Open Questions (1)
- [Q4] Does the efficiency claim generalize beyond English? → questions [C1]
```

The agent now reasons with awareness of the full evidence landscape.

### 4. Graph Commands

```
/graph                    — show summary (claims, findings, questions, connections)
/graph claims             — list all claims with confidence + evidence count
/graph around <id>        — show a node and its direct connections
/graph conflicts          — list all contradictions
/graph unsupported        — claims with no supporting evidence
/graph export             — export as markdown, JSON, or visualization
```

## Migration Path

### Phase 1: Extend the schema (backward compatible)

Add optional fields to existing `Memory` type. Old memories still work — they just have `type: undefined` and `edges: []`.

```typescript
interface Memory {
  // ... existing fields unchanged ...
  
  // New optional fields:
  type?: MemoryNode["type"];
  confidence?: MemoryNode["confidence"];
  origin?: MemoryNode["origin"];
  edges?: MemoryNode["edges"];
}
```

Store version stays `2` — new fields are optional. No migration needed.

### Phase 2: Upgrade the extractor

Update the LLM extraction prompt to produce structured nodes. The extraction still runs after each turn, same hook. It just outputs richer data.

### Phase 3: Graph-aware prompt injection

Replace `formatMemoriesForPrompt()` with `formatGraphForPrompt()` that produces the structured summary shown above. The agent can now reference nodes by ID.

### Phase 4: Proactive conflict detection

Before each agent turn, scan the graph for relevant conflicts/gaps and inject them as "things to be aware of."

### Phase 5: Graph commands

Add `/graph` slash command family. Start with `claims`, `conflicts`, `unsupported`.

## Data Model Choices

### Why not a separate database?

The current memory store is a JSON file per project. For research projects (typically 50-500 nodes), this is fine. JSON is:
- Human-readable (user can inspect their knowledge base)
- Portable (copy the workspace, graph comes with it)
- Simple (no database setup)

If a project exceeds ~1000 nodes, compress old low-relevance nodes into summaries (existing eviction logic, evolved). A SQLite store would be Phase 6+, only if needed.

### Why edges live on nodes (not in a separate table)?

Edges are stored as arrays on the source node. This means:
- Loading a node gives you its connections immediately
- No join queries needed
- Traversal is: load node → read edges → load target nodes
- For our scale (50-500 nodes) this is faster than a separate edge store

### Why confidence is on nodes, not edges?

A claim's confidence is about the claim itself, not about a specific connection. "Transformers are efficient" might be `medium` confidence because there's mixed evidence — that's a property of the claim, informed by all its edges collectively.

## What Makes This Different From Every Other Tool

1. **It grows from conversation, not manual tagging.** The user never has to "build a knowledge graph." They just do research. The graph assembles itself.

2. **It's opinionated about research structure.** Not a generic graph. The node types (claim, finding, source, question, method, insight, decision) map directly to how researchers actually think.

3. **It talks back.** The graph isn't passive. It injects conflicts, gaps, and evidence status into the agent's reasoning. "You're about to make an unsupported claim" is worth more than a thousand nodes.

4. **It's project-scoped with global identity.** Your researcher identity (global memories) persists. Your evidence network (project memories) is scoped to the project. Start a new project, start a fresh graph, keep your preferences.

5. **It's the deliverable, not just a tool.** Export the graph as a structured literature review, evidence matrix, or annotated bibliography. The graph IS the research output.
