import type { LLMProvider } from "@/lib/llm/provider";
import { getProviderCatalog } from "@/lib/llm/provider-catalog";
import type { LLMMessage } from "@/lib/llm/types";
import type { Ontology } from "./types";
import { loadOntology } from "./store";
import { getNote, searchNotes, getConnections } from "./read-tools";

// ── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You answer research questions by reading a project's ontology — a structured graph of sources, findings, claims, questions, methods, and insights connected by typed edges (supports, contradicts, derived-from, relates-to).

# How to search

Pick the right strategy based on the question type:

| Question type | Search approach | Example |
|---------------|----------------|---------|
| Structural | Use filters only (no text) | "unsupported claims" → { kind: "claim", missingEdge: "supports" } |
| Specific entity | Text query + kind filter | "Smith 2024 findings" → { queries: ["Smith 2024"], kind: "source" } then follow derived-from edges |
| Broad topic | Multiple synonym phrases | "attention efficiency" → { queries: ["attention efficiency", "quadratic scaling", "computational cost"] } |
| Evidence chain | Find the claim, then traverse | search for claim → get_connections depth 2 → follow supports/contradicts edges |

After finding any node, ALWAYS call get_connections to explore its neighborhood. The most relevant notes are often one edge away from a search result.

# Response rules

- Write for a researcher: be precise, cite specific sources and page/table numbers when available
- Always state the confidence level of claims and findings you reference
- When reporting contradictions, present BOTH sides with their edge contexts — do not take a side
- Explicitly say what's NOT in the ontology: "The ontology has no data on X" is a useful answer
- Never include raw note IDs — use source names and natural language references
- Aim for 100-300 words. Longer for complex evidence chains. Shorter for simple lookups.`;

// ── Read-Only Tool Definitions ─────────────────────────────────────────────

const QUERY_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_note",
      description: "Retrieve a single note by ID. Returns full content, kind, confidence, all edges with their contexts, and source metadata. Use when you have a note ID from search results or edge targets and need the complete details.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "UUID of the note" },
        },
        required: ["noteId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_notes",
      description:
        "Find notes by text and/or structural filters. Include 2-3 synonym phrases for broad queries. " +
        "Combine text with kind filter for precision. Use structural filters for graph-shape queries " +
        "(e.g. unsupported claims → { kind: 'claim', missingEdge: 'supports' }).",
      parameters: {
        type: "object",
        properties: {
          queries: { type: "array", items: { type: "string" }, description: "Text search phrases (OR logic). Include synonyms: ['attention efficiency', 'quadratic scaling', 'computational cost']" },
          kind: { type: "string", enum: ["source", "finding", "claim", "question", "method", "insight"] },
          confidence: { type: "string", enum: ["established", "supported", "hypothesized", "questioned", "refuted"] },
          hasEdge: { type: "string", enum: ["supports", "contradicts", "derived-from", "relates-to"], description: "Note must have at least one edge of this type" },
          missingEdge: { type: "string", enum: ["supports", "contradicts", "derived-from", "relates-to"], description: "Note must have NO edges of this type" },
          limit: { type: "number", description: "Max results. Default: 10" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_connections",
      description:
        "Explore a note's neighborhood by traversing edges. Returns the note and all connected notes within N hops. " +
        "ALWAYS call after search_notes finds a relevant node — the most important information is often one edge away.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Starting note ID" },
          depth: { type: "number", description: "Hops to traverse. Default: 1 (immediate neighbors). Use 2 for evidence chains." },
        },
        required: ["noteId"],
        additionalProperties: false,
      },
    },
  },
];

// ── Execute Read Tool ──────────────────────────────────────────────────────

function executeQueryTool(
  name: string,
  args: Record<string, unknown>,
  ontology: Ontology
): string {
  switch (name) {
    case "get_note": {
      const note = getNote(ontology, String(args.noteId));
      if (!note) return `Note not found: ${args.noteId}`;
      return JSON.stringify(note, null, 2);
    }
    case "search_notes": {
      const results = searchNotes(ontology, {
        queries: args.queries as string[] | undefined,
        kind: args.kind as any,
        confidence: args.confidence as any,
        hasEdge: args.hasEdge as any,
        missingEdge: args.missingEdge as any,
        limit: args.limit as number | undefined,
      });
      if (results.length === 0) return "No matching notes found.";
      return results.map((n) =>
        `[${n.id}] (${n.kind}, ${n.confidence}) "${n.content}" — ${n.edges.length} edges`
      ).join("\n");
    }
    case "get_connections": {
      const { root, connected } = getConnections(
        ontology,
        String(args.noteId),
        (args.depth as number) ?? 1
      );
      if (!root) return `Note not found: ${args.noteId}`;
      const lines = [
        `Root: [${root.id}] (${root.kind}, ${root.confidence}) "${root.content}"`,
        `Edges: ${root.edges.map((e) => `${e.relation}(${e.strength}) → ${e.targetId} — "${e.context}"`).join("\n  ") || "none"}`,
        `Connected (${connected.length}):`,
        ...connected.map((c) =>
          `  [${c.id}] (${c.kind}, ${c.confidence}) "${c.content}" — edges: ${c.edges.map((e) => `${e.relation} → ${e.targetId.slice(0, 8)}`).join(", ") || "none"}`
        ),
      ];
      return lines.join("\n");
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Run Query Agent ────────────────────────────────────────────────────────

const MAX_ITERATIONS = 8;

export async function runQueryAgent(input: {
  query: string;
  scope?: string;
  provider: LLMProvider;
  workspaceDir: string;
}): Promise<string> {
  const ontology = await loadOntology(input.workspaceDir);

  if (ontology.notes.length === 0) {
    return "The ontology is empty — no notes have been captured yet. As you do research, the ontology will automatically populate with sources, findings, and claims.";
  }

  const userMessage = input.scope
    ? `${input.query}\n\n(Focus on: ${input.scope})`
    : input.query;

  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let fullText = "";
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const chunk of input.provider.callLLMStreaming({
      messages,
      tools: QUERY_TOOLS,
      model: getProviderCatalog(input.provider.kind).backgroundModel,
    })) {
      if (chunk.type === "text_delta") {
        fullText += chunk.content;
      } else if (chunk.type === "done") {
        toolCalls = chunk.toolCalls;
      }
    }

    // No tool calls → this is the final synthesized answer
    if (toolCalls.length === 0) {
      return fullText || "(Query agent returned empty response)";
    }

    // Add assistant message with tool calls
    messages.push({
      role: "assistant",
      content: fullText || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute each tool call against the ontology
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.arguments || "{}");
      const result = executeQueryTool(toolCall.name, args, ontology);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  // Hit iteration limit — ask for a summary
  messages.push({
    role: "user",
    content: "Summarize what you've found so far. Be concise.",
  });

  let finalText = "";
  for await (const chunk of input.provider.callLLMStreaming({
    messages,
    model: getProviderCatalog(input.provider.kind).backgroundModel,
  })) {
    if (chunk.type === "text_delta") finalText += chunk.content;
  }

  return finalText || "(Query agent could not synthesize an answer)";
}
