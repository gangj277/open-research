import type { LLMProvider } from "@/lib/llm/provider";
import { getProviderCatalog } from "@/lib/llm/provider-catalog";
import type { LLMMessage } from "@/lib/llm/types";
import type { Ontology } from "./types";
import { loadOntology, saveOntology } from "./store";
import { getNote, searchNotes, getConnections, findExistingSource } from "./read-tools";
import {
  createNote, createEdge, updateNote, updateEdge, removeEdge, mergeNotes,
} from "./write-tools";

// ── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Ontology Manager. You maintain the structured knowledge graph for a research project.

# Your single job

After each conversation turn, you receive the researcher's message, the AI assistant's response, and any tool outputs. You decide what substantive knowledge to extract and how to structure it in the ontology.

You output ONLY tool calls. No conversational text. When you're done, stop calling tools — that signals completion.

# Decision process

For each turn, follow this sequence:

1. READ the turn. Identify any substantive knowledge: new sources, findings, claims, methods, questions, or insights.
2. SKIP if the turn contains only chitchat, UI commands, greetings, or meta-conversation. Outputting 0 operations is correct.
3. SEARCH before writing. For every piece of knowledge you want to capture, first call search_notes to check if it already exists. Duplicate notes degrade the entire system.
4. WRITE only what's new. Create notes, add edges, or update existing notes. Typical turn: 1-5 operations.

# Note kinds

| Kind | What it captures | Required edges |
|------|-----------------|----------------|
| source | A citable origin: paper, URL, dataset, book | None |
| finding | A specific result from a source | MUST have derived-from → source |
| claim | An argument or assertion in the research | None (but should accumulate supports/contradicts over time) |
| question | An open gap, uncertainty, or research question | None |
| method | A methodology or analytical technique | None |
| insight | A synthesis connecting multiple findings/claims | SHOULD have derived-from → the findings/claims it synthesizes |

# Edge creation — decision tree

When connecting two notes, use this decision tree:

Is note A direct provenance for note B? (A was extracted from B, or B was synthesized from A)
  → YES: derived-from (directed, A → B)

Does note A provide direct empirical evidence that tests what note B claims?
  → YES: supports (directed, A → B)
  → A is merely about the same topic as B: relates-to (NOT supports)

Do notes A and B assert things that CANNOT BOTH BE TRUE about the same variable, measured in comparable conditions?
  → YES: contradicts (mutual)
  → They measure different things, or use different conditions: relates-to (NOT contradicts)

None of the above, but genuinely connected?
  → relates-to (mutual)

## Edge context — good vs bad

The context field explains WHY the connection exists. It must add information beyond the relation type.

GOOD:
- "Table 3 reports 12% BLEU improvement on WMT14 EN-DE (p<0.01), directly testing the scaling hypothesis under identical conditions"
- "Chen used 10x larger training data and observed inverse scaling, suggesting the original finding is dataset-size-dependent"
- "Synthesized from the sample-size observation (Smith) and the scaling curve (Jones) to hypothesize diminishing returns above 10B parameters"

BAD:
- "supports the claim" (redundant — the relation field already says this)
- "related" (says nothing)
- "from this paper" (the edge already points to the source)

# Confidence

Only change confidence when the conversation provides EXPLICIT evidence. Do not infer from tone or speculation. When uncertain, leave unchanged.

Defaults: source/finding/method → established | claim/insight → hypothesized | question → questioned

# Critical constraint

A wrong edge is worse than a missing edge. Missing edges can be added later. Wrong edges actively mislead the researcher's analysis. When uncertain about an edge type, use relates-to with explanatory context, or skip the edge entirely.`;

// ── Internal Tool Definitions ──────────────────────────────────────────────

const MANAGER_TOOLS = [
  // ── Read tools ───────────────────────────────────────────────────────
  {
    type: "function" as const,
    function: {
      name: "get_note",
      description: "Retrieve a single note by ID. Returns its content, kind, confidence, all edges, and source metadata. Use when you already have a note ID from search results or edge targets.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "UUID of the note to retrieve" },
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
        "Find notes by text and/or structure. ALWAYS call this before create_note to check for duplicates. " +
        "Combine text queries with structural filters for precise results. " +
        "Example: find unsupported claims → { kind: 'claim', missingEdge: 'supports' }. " +
        "Example: find a paper → { queries: ['Smith 2024', 'attention scaling'], kind: 'source' }.",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
            description: "Text search phrases (OR logic). Include 2-3 phrasings to cover synonyms. E.g. ['transformer efficiency', 'attention scaling', 'BLEU improvement']",
          },
          kind: { type: "string", enum: ["source", "finding", "claim", "question", "method", "insight"] },
          confidence: { type: "string", enum: ["established", "supported", "hypothesized", "questioned", "refuted"] },
          hasEdge: { type: "string", enum: ["supports", "contradicts", "derived-from", "relates-to"], description: "Note must have at least one outgoing or incoming mutual edge of this type" },
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
        "Explore a note's neighborhood. Returns the note and all notes connected within N hops. " +
        "Call this BEFORE creating edges to understand what's already connected. " +
        "Also useful for finding notes that search_notes missed — follow edges to discover related notes.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Starting note ID" },
          depth: { type: "number", description: "Hops to traverse. Default: 1, max: 3. Use 1 for immediate neighbors, 2 for extended context." },
        },
        required: ["noteId"],
        additionalProperties: false,
      },
    },
  },
  // ── Write tools ──────────────────────────────────────────────────────
  {
    type: "function" as const,
    function: {
      name: "create_note",
      description:
        "Create a new note in the ontology. PREREQUISITE: You must call search_notes first to verify this note doesn't already exist. " +
        "If a similar note exists, use update_note or create_edge instead. " +
        "For findings: you MUST create a derived-from edge to the source immediately after.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Clear, factual description in 1-3 sentences. Be specific — include numbers, conditions, and qualifiers." },
          kind: { type: "string", enum: ["source", "finding", "claim", "question", "method", "insight"] },
          confidence: { type: "string", enum: ["established", "supported", "hypothesized", "questioned", "refuted"], description: "Omit to use default for the kind" },
          meta: {
            type: "object",
            description: "Citation metadata. Only for kind: 'source'. Include as many fields as available.",
            properties: {
              authors: { type: "string", description: "Author names, e.g. 'Vaswani, Shazeer, Parmar, et al.'" },
              year: { type: "number" },
              venue: { type: "string", description: "Publication venue, e.g. 'NeurIPS 2017'" },
              url: { type: "string" },
              doi: { type: "string" },
              filePath: { type: "string", description: "Workspace-relative path to the file, e.g. 'sources/vaswani-2017.pdf'" },
            },
            additionalProperties: false,
          },
        },
        required: ["content", "kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_edge",
      description:
        "Connect two notes with a typed, directional relationship. Follow the edge decision tree in your instructions. " +
        "Key rules: supports/derived-from are always 'directed'. contradicts/relates-to are always 'mutual'. " +
        "The context field must explain WHY — not just restate the relation.",
      parameters: {
        type: "object",
        properties: {
          sourceNoteId: { type: "string", description: "ID of the FROM note" },
          targetNoteId: { type: "string", description: "ID of the TO note" },
          relation: { type: "string", enum: ["supports", "contradicts", "derived-from", "relates-to"] },
          strength: {
            type: "string",
            enum: ["strong", "moderate", "weak"],
            description: "strong = direct, unambiguous connection. moderate = relevant but indirect. weak = tangential.",
          },
          direction: {
            type: "string",
            enum: ["directed", "mutual"],
            description: "directed: supports, derived-from (A→B only). mutual: contradicts, relates-to (bidirectional).",
          },
          context: {
            type: "string",
            description: "Explain WHY this connection exists with specific details. Must add information beyond the relation type. Include page numbers, table references, conditions, or reasoning.",
          },
        },
        required: ["sourceNoteId", "targetNoteId", "relation", "strength", "direction", "context"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_note",
      description: "Modify a note's content or confidence. Use when new information refines, extends, or corrects an existing note rather than creating a duplicate.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string" },
          content: { type: "string", description: "Replacement content. Omit to keep current." },
          confidence: { type: "string", enum: ["established", "supported", "hypothesized", "questioned", "refuted"], description: "New confidence level. Only change with explicit evidence. Omit to keep current." },
        },
        required: ["noteId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_edge",
      description: "Modify an existing edge's strength or context. Use when new evidence changes the strength of a connection, or when context needs to be enriched.",
      parameters: {
        type: "object",
        properties: {
          sourceNoteId: { type: "string" },
          targetNoteId: { type: "string" },
          relation: { type: "string", enum: ["supports", "contradicts", "derived-from", "relates-to"], description: "Identifies which edge to update (source + target + relation is unique)" },
          strength: { type: "string", enum: ["strong", "moderate", "weak"] },
          context: { type: "string" },
        },
        required: ["sourceNoteId", "targetNoteId", "relation"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remove_edge",
      description: "Delete an edge that was created incorrectly. Only use when the relationship is definitively wrong — not just weak.",
      parameters: {
        type: "object",
        properties: {
          sourceNoteId: { type: "string" },
          targetNoteId: { type: "string" },
          relation: { type: "string", enum: ["supports", "contradicts", "derived-from", "relates-to"] },
        },
        required: ["sourceNoteId", "targetNoteId", "relation"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "merge_notes",
      description: "Combine two duplicate notes into one. All edges pointing to the removed note are redirected to the kept note. Duplicate edges are deduplicated (strongest wins). Use when search reveals the same knowledge was captured twice.",
      parameters: {
        type: "object",
        properties: {
          keepNoteId: { type: "string", description: "ID of the note to keep (usually the more complete one)" },
          removeNoteId: { type: "string", description: "ID of the note to remove — its edges will be redirected" },
          mergedContent: { type: "string", description: "Optional: replacement content that combines both notes' information" },
        },
        required: ["keepNoteId", "removeNoteId"],
        additionalProperties: false,
      },
    },
  },
];

const READ_ONLY_TOOLS = new Set(["get_note", "search_notes", "get_connections"]);

// ── Internal Tool Executor ─────────────────────────────────────────────────

function executeManagerTool(
  name: string,
  args: Record<string, unknown>,
  ontology: Ontology
): { result: string; ontology: Ontology } {
  try {
    switch (name) {
      // Read tools
      case "get_note": {
        const note = getNote(ontology, String(args.noteId));
        if (!note) return { result: `Note not found: ${args.noteId}`, ontology };
        return { result: JSON.stringify(note, null, 2), ontology };
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
        if (results.length === 0) return { result: "No matching notes found.", ontology };
        return {
          result: results.map((n) =>
            `[${n.id}] (${n.kind}, ${n.confidence}) "${n.content}" — ${n.edges.length} edges`
          ).join("\n"),
          ontology,
        };
      }
      case "get_connections": {
        const { root, connected } = getConnections(
          ontology,
          String(args.noteId),
          (args.depth as number) ?? 1
        );
        if (!root) return { result: `Note not found: ${args.noteId}`, ontology };
        const lines = [
          `Root: [${root.id}] (${root.kind}) "${root.content}"`,
          `Edges: ${root.edges.map((e) => `${e.relation} → ${e.targetId.slice(0, 8)}`).join(", ") || "none"}`,
          `Connected (${connected.length}):`,
          ...connected.map((c) => `  [${c.id}] (${c.kind}) "${c.content}"`),
        ];
        return { result: lines.join("\n"), ontology };
      }

      // Write tools
      case "create_note": {
        const { ontology: updated, noteId } = createNote(ontology, {
          content: String(args.content),
          kind: String(args.kind) as any,
          confidence: args.confidence as any,
          meta: args.meta as any,
        });
        return { result: `Created note: ${noteId}`, ontology: updated };
      }
      case "create_edge": {
        const { ontology: updated, edgeId } = createEdge(ontology, {
          sourceNoteId: String(args.sourceNoteId),
          targetNoteId: String(args.targetNoteId),
          relation: String(args.relation) as any,
          strength: String(args.strength) as any,
          direction: String(args.direction) as any,
          context: String(args.context),
        });
        return { result: `Created edge: ${edgeId}`, ontology: updated };
      }
      case "update_note": {
        const updated = updateNote(ontology, {
          noteId: String(args.noteId),
          content: args.content as string | undefined,
          confidence: args.confidence as any,
        });
        return { result: `Updated note: ${args.noteId}`, ontology: updated };
      }
      case "update_edge": {
        const updated = updateEdge(ontology, {
          sourceNoteId: String(args.sourceNoteId),
          targetNoteId: String(args.targetNoteId),
          relation: String(args.relation) as any,
          strength: args.strength as any,
          context: args.context as string | undefined,
        });
        return { result: `Updated edge.`, ontology: updated };
      }
      case "remove_edge": {
        const updated = removeEdge(ontology, {
          sourceNoteId: String(args.sourceNoteId),
          targetNoteId: String(args.targetNoteId),
          relation: String(args.relation) as any,
        });
        return { result: `Removed edge.`, ontology: updated };
      }
      case "merge_notes": {
        const { ontology: updated, edgesRedirected } = mergeNotes(ontology, {
          keepNoteId: String(args.keepNoteId),
          removeNoteId: String(args.removeNoteId),
          mergedContent: args.mergedContent as string | undefined,
        });
        return { result: `Merged. ${edgesRedirected} edges redirected.`, ontology: updated };
      }
      default:
        return { result: `Unknown tool: ${name}`, ontology };
    }
  } catch (err: any) {
    return { result: `Error: ${err?.message ?? err}`, ontology };
  }
}

// ── Truncate Tool Outputs ──────────────────────────────────────────────────

const MAX_TOOL_OUTPUT_CHARS = 32_000; // ~8K tokens

function truncateToolOutputs(
  outputs: Array<{ tool: string; input: string; output: string }>
): string {
  if (outputs.length === 0) return "(no tool calls this turn)";

  // Take from the end (most recent tools are most relevant)
  let total = 0;
  const included: typeof outputs = [];
  for (let i = outputs.length - 1; i >= 0; i--) {
    const entry = outputs[i]!;
    const size = entry.tool.length + entry.output.length;
    if (total + size > MAX_TOOL_OUTPUT_CHARS && included.length > 0) break;
    included.unshift(entry);
    total += size;
  }

  return included
    .map((o) => `[${o.tool}] ${o.output.slice(0, 4000)}`)
    .join("\n\n");
}

// ── Run Ontology Manager ───────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

export async function runOntologyManager(input: {
  userMessage: string;
  agentResponse: string;
  toolOutputs: Array<{ tool: string; input: string; output: string }>;
  provider: LLMProvider;
  workspaceDir: string;
}): Promise<void> {
  // Load ontology once at start — all mutations happen in memory, save once at end
  let ontology = await loadOntology(input.workspaceDir);

  const turnSummary = [
    `## Conversation Turn`,
    ``,
    `**User:** ${input.userMessage.slice(0, 3000)}`,
    ``,
    `**Agent response:** ${input.agentResponse.slice(0, 3000)}`,
    ``,
    `**Tool outputs:**`,
    truncateToolOutputs(input.toolOutputs),
  ].join("\n");

  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: turnSummary },
  ];

  let mutated = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let fullText = "";
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const chunk of input.provider.callLLMStreaming({
      messages,
      tools: MANAGER_TOOLS,
      model: getProviderCatalog(input.provider.kind).defaultModel,
    })) {
      if (chunk.type === "text_delta") {
        fullText += chunk.content;
      } else if (chunk.type === "done") {
        toolCalls = chunk.toolCalls;
      }
    }

    // No tool calls → manager is done
    if (toolCalls.length === 0) break;

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

    // Execute each tool call
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.arguments || "{}");
      const { result, ontology: updated } = executeManagerTool(
        toolCall.name,
        args,
        ontology
      );

      // Track mutations — write tools mutate ontology in place (same reference),
      // so we detect by tool name rather than reference identity
      if (!READ_ONLY_TOOLS.has(toolCall.name)) mutated = true;
      ontology = updated;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  // Save only if something changed
  if (mutated) {
    await saveOntology(ontology, input.workspaceDir);
  }
}
