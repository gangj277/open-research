# Ontology System

Design documents for the Open Research ontology — evolving the memory system into a structured research knowledge base.

## Documents

| Document | Description |
|----------|-------------|
| **[Master Overview](./00-master-overview.md)** | **Start here.** What, why, four-agent architecture, ontology summary, quality safeguards, implementation scope |
| [Ontology Spec](./01-ontology-spec.md) | Full data model — node type, edge types, kinds, confidence levels, storage |
| [Ontology Manager](./02-agent-pipeline.md) | Background write agent — strict edge creation rules, 9 tools, execution flow |
| [Agent Usage Pipeline](./03-agent-usage-pipeline.md) | Relevance agent + scaffolding + query agent — how the main agent reads the graph |
| [Migration Plan](./04-migration-plan.md) | How to evolve the current memory system into the ontology *(upcoming)* |

## Four-Agent Architecture

```
Relevance Agent (gpt-5.4-mini)  — semantic matching: picks relevant notes for scaffolding
Main Agent (gpt-5.4)            — does research, reads ontology via query_ontology tool
Query Agent (gpt-5.4-mini)      — reads ontology deeply when main agent asks, returns synthesized answers
Ontology Manager (gpt-5.4)      — writes to ontology after each completed interaction (background)
```

Read tools (`get_note`, `search_notes`, `get_connections`) are shared by the query agent and ontology manager. Only the ontology manager has write tools. The main agent never touches the ontology directly.

## Design Principles

1. **One node type, uniform edges.** No special cases. Everything is a Note, everything connects the same way.
2. **Per-workspace scope.** Each research project has its own ontology. Global researcher identity stays in the existing memory system.
3. **Four agents, four concerns.** Relevance matches. Main agent researches. Query agent reads. Ontology manager writes.
4. **Scaffolding + active query.** The relevance agent + scaffolding orient the main agent on what exists. The query agent gives it the real answers.
5. **Strict edge creation rules.** The ontology manager follows precise rules to prevent hallucinated edges. When in doubt, it does not create the edge.
6. **User correction.** `/ontology` commands let the user view, edit, and delete ontology state directly.
7. **Meaning comes from structure, not labels.** An "unsupported claim" is a claim with no `supports` edges. Query the shape, not the metadata.
