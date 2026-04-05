import type { ToolDefinition } from "./tools";

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
      description: "Create a new workspace file.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          content: { type: "string" },
          folder: { type: "string" },
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
      description: "Search OpenAlex, Semantic Scholar, and arXiv for academic papers.",
      parameters: {
        type: "object",
        properties: {
          searches: { type: "array", items: { type: "object" } },
          num_results: { type: "number" },
        },
        required: ["searches"],
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
        "Ask the user a question and wait for their response. " +
        "Use this when you need clarification, a decision between options, or confirmation before proceeding. " +
        "Provide clear options when possible. The user can also type a custom answer.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask the user.",
          },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Short option label (1-5 words)." },
                description: { type: "string", description: "One-sentence description of this option." },
              },
              required: ["label", "description"],
            },
            description: "Predefined options for the user to choose from.",
          },
          allow_custom: {
            type: "boolean",
            description: "Whether the user can type a custom answer. Default: true.",
          },
        },
        required: ["question"],
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
];

// ── Tool Filtering for Planning Mode ──

const PLANNING_TOOL_NAMES = new Set([
  "read_file",
  "read_pdf",
  "list_directory",
  "search_workspace",
  "fetch_url",
  "search_external_sources",
  "load_skill",
  "read_skill_reference",
  "ask_user",
]);

export function getToolsForMode(mode: "planning" | "full"): ToolDefinition[] {
  if (mode === "planning") {
    return TOOL_SCHEMAS.filter((t) => PLANNING_TOOL_NAMES.has(t.function.name));
  }
  return TOOL_SCHEMAS;
}
