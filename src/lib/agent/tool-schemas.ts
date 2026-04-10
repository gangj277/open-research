import type { ToolDefinition } from "./tools";

interface ToolMeta {
  parallelSafe: boolean;
}

export const TOOL_SCHEMAS: ToolDefinition[] = [
  // ── File & Workspace ────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a file by path. Supports any text file on disk. Returns numbered lines. " +
        "Use offset/limit for large files. Detects binary files automatically. " +
        "Also works with workspace keys (e.g. 'path:notes/brief.md') for backward compatibility.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute or relative file path, or a workspace key.",
          },
          offset: {
            type: "number",
            description: "1-indexed line number to start reading from. Default: 1.",
          },
          limit: {
            type: "number",
            description: "Maximum number of lines to return. Default/max: 2000.",
          },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_pdf",
      description:
        "Extract text from a PDF file. Returns the full text content. " +
        "For large PDFs, use the pages parameter to read specific page ranges. " +
        "Works with any PDF on disk.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute or relative path to the PDF file.",
          },
          pages: {
            type: "string",
            description:
              'Page range to extract, e.g. "3" for a single page or "1-5" for a range. Omit to read all pages.',
          },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List files and directories as a tree. Defaults to the current working directory. " +
        "Use depth to control how deep to recurse (default 2, max 5). " +
        "Common directories like node_modules, .git, __pycache__ are hidden by default.",
      parameters: {
        type: "object",
        properties: {
          dir_path: {
            type: "string",
            description: "Directory path. Defaults to cwd if omitted.",
          },
          depth: {
            type: "number",
            description: "Max depth to recurse. Default: 2, max: 5.",
          },
          ignore: {
            type: "array",
            items: { type: "string" },
            description: "Additional directory names to ignore.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_workspace",
      description: "Search across workspace files for one or more terms.",
      parameters: {
        type: "object",
        properties: {
          queries: { type: "array", items: { type: "string" } },
          context_lines: { type: "number" },
          file_keys: { type: "array", items: { type: "string" } },
          max_results: { type: "number" },
        },
        required: ["queries"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_new_file",
      description: [
        "Create a new workspace file. The key determines where the file is placed:",
        "- `note:<descriptive-slug>` → notes/<slug>.md — analysis, summaries, briefs, memos",
        "- `paper:<descriptive-slug>` → papers/<slug>.tex — LaTeX drafts and manuscripts",
        "- `experiment:<descriptive-slug>` → experiments/<slug>.json — experiment configs and results",
        "- `source:<descriptive-slug>` → sources/<slug>.md — extracted source material",
        "- `path:<relative/path.ext>` → exact path — scripts, configs, data files, any custom location",
        "Use path: for code files (e.g. `path:scripts/analyze.py`, `path:data/results.csv`).",
        "Use descriptive slugs, not UUIDs: `note:transformer-scaling-laws` not `note:abc123`.",
        "Use the folder param to organize within managed directories (e.g. folder: \"lit-review\").",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "File key with prefix determining placement: note:<slug>, paper:<slug>, experiment:<slug>, source:<slug>, or path:<relative/path>" },
          label: { type: "string", description: "Human-readable display name for the file" },
          content: { type: "string" },
          folder: { type: "string", description: "Optional subfolder within the managed directory for organization" },
        },
        required: ["key", "label", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_existing_file",
      description: "Propose an edit to an existing workspace file.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          summary: { type: "string" },
          mode: { type: "string", enum: ["rewrite", "targeted"] },
          content: { type: "string" },
          edits: { type: "array", items: { type: "object" } },
        },
        required: ["key", "summary"],
        additionalProperties: false,
      },
    },
  },

  // ── Shell Execution ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Execute a shell command (bash) and return stdout+stderr. " +
        "Use this to run scripts (python, R, node), compile LaTeX, install packages, process data, " +
        "or any other terminal operation. " +
        "Default timeout is 2 minutes, max 10 minutes. " +
        "Output is truncated to 50 KB — for large outputs, redirect to a file and use read_file.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute.",
          },
          workdir: {
            type: "string",
            description: "Working directory. Defaults to the workspace root.",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds. Default: 120000, max: 600000.",
          },
          description: {
            type: "string",
            description: "Brief description of what this command does (for the user).",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },

  // ── Web & Discovery ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch a URL and return its content. HTML pages are converted to plain text. " +
        "JSON responses are pretty-printed. Binary content is detected and reported. " +
        "Use this for fetching datasets, API responses, documentation, or web pages. " +
        "For scholarly paper search, prefer search_external_sources instead.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch (http or https).",
          },
          format: {
            type: "string",
            enum: ["text", "html", "raw"],
            description: "How to return HTML content. 'text' (default) strips tags, 'html' returns raw HTML.",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds. Default: 30000, max: 120000.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_external_sources",
      description:
        "Search OpenAlex, Semantic Scholar, and arXiv for academic papers, " +
        "then fetch content (PDFs, abstracts) and extract structured findings relative to the target. " +
        "Returns supports/contradicts/related evidence for each source.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "The research claim, hypothesis, or question to evaluate sources against. " +
              "Each paper will be analyzed for evidence that supports, contradicts, or relates to this target. " +
              "Be specific: 'What speedups do efficient attention methods achieve' not 'attention'.",
          },
          searches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query string." },
                intent: { type: "string", description: "Brief description of what you're looking for with this query." },
              },
              required: ["query"],
              additionalProperties: false,
            },
            description: "Array of search queries. First is primary, rest are variations.",
          },
          num_results: {
            type: "number",
            description: "Maximum number of results to return. Default: 8.",
          },
        },
        required: ["target", "searches"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web, fetch top results, and extract structured findings " +
        "relative to the target. Automatically generates adversarial queries to find " +
        "contradicting evidence. Use for non-academic sources: documentation, blog posts, " +
        "datasets, reports, news. For academic papers, use search_external_sources.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "The research claim or question to evaluate results against. " +
              "Be specific: 'How to configure num_workers in PyTorch DataLoader for multi-GPU' not 'PyTorch'.",
          },
          queries: {
            type: "array",
            items: { type: "string" },
            description: "Search queries. Multiple queries broaden coverage. Adversarial queries are auto-generated.",
          },
          query: {
            type: "string",
            description: "Single search query (alternative to queries array for backward compatibility).",
          },
          num_results: {
            type: "number",
            description: "Maximum pages to fetch and analyze. Default: 5, max: 8.",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
  },

  // ── User Interaction ────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user one or more questions and wait for their responses. " +
        "Use when you need clarification, a decision, or confirmation before proceeding. " +
        "You can batch up to 4 related questions in a single call — the user answers them all at once. " +
        "Provide predefined options when possible. The user can arrow-key select or type a custom answer.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description: "Clear, specific question. State what you need to know and why.",
                },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Short option label (1-5 words)" },
                      description: { type: "string", description: "One-sentence explanation of what this choice means" },
                    },
                    required: ["label", "description"],
                  },
                  description: "Predefined options. Include 2-5 choices. The user can also type a custom answer.",
                },
              },
              required: ["question"],
            },
            description: "One or more questions to ask. Batch related questions together (max 4).",
          },
          // Legacy single-question support (backward compat)
          question: {
            type: "string",
            description: "Single question (shorthand). Use 'questions' array for multiple.",
          },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                description: { type: "string" },
              },
              required: ["label", "description"],
            },
            description: "Options for single question (shorthand).",
          },
        },
        additionalProperties: false,
      },
    },
  },

  // ── Skills ──────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "load_skill",
      description: "Load a skill by name.",
      parameters: {
        type: "object",
        properties: {
          skill_id: { type: "string" },
        },
        required: ["skill_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_skill_reference",
      description: "Read a reference file from an active skill.",
      parameters: {
        type: "object",
        properties: {
          skill_id: { type: "string" },
          path: { type: "string" },
        },
        required: ["skill_id", "path"],
        additionalProperties: false,
      },
    },
  },

  // ── Paper Creation ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_paper",
      description: "Create a new LaTeX paper file.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
    },
  },
  // ── Sub-Agent ──────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "launch_subagent",
      description:
        "Launch a sub-agent to handle a task autonomously with its own context window. " +
        "Returns a structured handoff report with summary, files created/modified, and key findings.\n\n" +
        "Available types:\n" +
        "- \"explore\": Read-only workspace exploration. Uses read_file, list_directory, search_workspace.\n" +
        "- \"research\": Write-capable research agent. Can search papers, run code, write files, traverse citations. " +
        "Optionally loaded with a skill workflow.\n\n" +
        "IMPORTANT: The sub-agent has ZERO context from this conversation. " +
        "Write detailed, self-contained instructions in goal and context.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["explore", "research"],
            description: "The type of sub-agent. Use 'research' for tasks that require writing files, searching papers, or running code.",
          },
          skill: {
            type: "string",
            description:
              "Optional skill to load as the sub-agent's workflow template. " +
              "Available: source-scout, experiment-designer, data-analyst, devils-advocate, " +
              "methodology-critic, evidence-adjudicator, novelty-checker, paper-explainer, " +
              "draft-paper, reviewer-response. When provided, type defaults to 'research'.",
          },
          goal: {
            type: "string",
            description:
              "Detailed, self-contained description of the task. " +
              "Include: (1) exactly what to accomplish, (2) what files or data to use, " +
              "(3) what output to produce and where to write it. " +
              "The more specific you are, the better the result.",
          },
          context: {
            type: "string",
            description:
              "Background the sub-agent needs. Include: what you already know, " +
              "what's already in the workspace, what to build on or avoid, " +
              "and any constraints or preferences from the user.",
          },
        },
        required: ["type", "goal"],
        additionalProperties: false,
      },
    },
  },
  // ── Current Task Focus ────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "set_current_task",
      description:
        "Set your current task/focus. This is injected into your context on every turn so you always " +
        "know what you're working on. Update it as you move through your plan. " +
        "Use a short imperative phrase: 'Searching for scaling law papers', " +
        "'Writing literature review section', 'Running experiment analysis'.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Short description of your current focus.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
  },
  // ── Ontology ──────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "query_ontology",
      description:
        "Ask a question about your research knowledge. A query agent traverses the project's ontology " +
        "(sources, findings, claims, contradictions, evidence chains) and returns a synthesized answer. " +
        "Use for: finding evidence for/against a claim, checking what contradicts something, " +
        "getting methodology details, or understanding how findings connect. " +
        "Returns a natural language answer — not raw data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural language research question. Be specific. " +
              "Good: 'what evidence contradicts the transformer efficiency claim?' " +
              "Good: 'what methods were used across the scaling studies?' " +
              "Bad: 'tell me about transformers' (too vague)",
          },
          scope: {
            type: "string",
            enum: ["claims", "sources", "questions", "methods", "findings", "insights"],
            description: "Narrow the search to a specific note kind. Omit to search everything.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ontology_status",
      description:
        "Get a snapshot of the research ontology: how many sources, findings, claims, methods, " +
        "questions, and insights have been captured. Also shows contradiction count, unsupported claims, " +
        "and open questions. Use to assess coverage, identify gaps, or decide what to investigate next.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "traverse_citations",
      description:
        "Follow citation chains from a known paper. Use 'references' to find foundational work " +
        "this paper builds on, or 'citations' to find later work that built on it. " +
        "Use after search_external_sources identifies a key paper — traverse its citations to " +
        "discover the research lineage, find replication studies, or identify the seminal papers in the field. " +
        "Results are sorted by citation count (most influential first).",
      parameters: {
        type: "object",
        properties: {
          paper_id: {
            type: "string",
            description:
              "Paper identifier: Semantic Scholar ID, DOI (e.g. '10.1234/...'), or arXiv ID (e.g. '2301.12345'). " +
              "Use identifiers from search_external_sources results.",
          },
          direction: {
            type: "string",
            enum: ["references", "citations"],
            description: "'references' = papers this paper cites (go backward in time). 'citations' = papers that cite this paper (go forward in time).",
          },
          limit: {
            type: "number",
            description: "Maximum number of results. Default: 10.",
          },
        },
        required: ["paper_id", "direction"],
        additionalProperties: false,
      },
    },
  },
];

const TOOL_META: Record<string, ToolMeta> = {
  read_file: { parallelSafe: true },
  read_workspace_files: { parallelSafe: true },
  read_pdf: { parallelSafe: true },
  list_directory: { parallelSafe: true },
  search_workspace: { parallelSafe: true },
  search_external_sources: { parallelSafe: true },
  fetch_url: { parallelSafe: true },
  launch_subagent: { parallelSafe: true },
  load_skill: { parallelSafe: true },
  read_skill_reference: { parallelSafe: true },
  write_new_file: { parallelSafe: false },
  update_existing_file: { parallelSafe: false },
  run_command: { parallelSafe: false },
  ask_user: { parallelSafe: false },
  create_paper: { parallelSafe: false },
  traverse_citations: { parallelSafe: true },
  set_current_task: { parallelSafe: true },
  web_search: { parallelSafe: true },
  query_ontology: { parallelSafe: true },
  ontology_status: { parallelSafe: true },
};

export function isParallelSafe(toolName: string): boolean {
  return TOOL_META[toolName]?.parallelSafe ?? false;
}


