# Open Research

Local-first research CLI agent. Discover papers, synthesize notes, run analysis, and draft artifacts from your terminal.

## Install

```bash
npm install -g open-research
```

Requires Node.js 20+.

## Quick Start

```bash
# Launch the TUI
open-research

# Connect your OpenAI account (inside the TUI)
/auth

# Initialize a workspace
/init

# Start researching
> What are the latest advances in transformer attention mechanisms?
```

## What It Does

Open Research is an AI-powered research agent that runs in your terminal. It connects to OpenAI's API and gives you a full research workflow:

- **Discover papers** across arXiv, Semantic Scholar, and OpenAlex
- **Read and analyze** PDFs, datasets, and web pages
- **Run code** — Python scripts, R analysis, LaTeX compilation, anything
- **Write artifacts** — notes, syntheses, paper drafts grounded in sources
- **Review changes** — risky edits go to a review queue for your approval

## Tools

The agent has access to:

| Tool | What it does |
|---|---|
| `read_file` | Read any file on disk (text, with binary detection) |
| `read_pdf` | Extract text from PDFs |
| `list_directory` | Explore directory trees |
| `run_command` | Execute shell commands (python, R, LaTeX, curl, etc.) |
| `search_workspace` | Search across workspace files |
| `write_new_file` | Create new workspace files |
| `update_existing_file` | Edit existing files |
| `search_external_sources` | Search academic paper databases |
| `fetch_url` | Fetch web pages and APIs |
| `ask_user` | Ask you questions when clarification is needed |
| `load_skill` | Activate research skills |
| `create_paper` | Create LaTeX paper drafts |

## Slash Commands

| Command | Description |
|---|---|
| `/auth` | Connect OpenAI account via browser |
| `/auth-codex` | Import existing Codex CLI auth |
| `/init` | Initialize workspace in current directory |
| `/skills` | List available research skills |
| `/config` | View or change settings |
| `/clear` | Start a new conversation |
| `/help` | Show all commands |
| `/exit` | Quit |

## Skills

Built-in research skills that guide the agent's methodology:

- **source-scout** — Find citation gaps and discover relevant papers
- **devils-advocate** — Stress-test claims and assumptions
- **methodology-critic** — Critique research methodology
- **evidence-adjudicator** — Evaluate evidence quality
- **experiment-designer** — Design experiments and studies
- **draft-paper** — Draft LaTeX papers from workspace evidence
- **paper-explainer** — Explain complex papers
- **synthesis-updater** — Update research syntheses
- **skill-creator** — Create custom skills

Type `/skill-name` in the TUI to activate any skill, or create your own in `~/.open-research/skills/`.

## Workspace Structure

```
my-research/
  sources/       # PDFs, papers, raw data
  notes/         # Research notes and briefs
  artifacts/     # Generated outputs
  papers/        # LaTeX paper drafts
  experiments/   # Analysis scripts and results
  .open-research/  # Workspace metadata
```

## Features

- **Markdown rendering** in terminal output (bold, italic, code blocks, lists, headings)
- **Slash command autocomplete** with arrow-key navigation
- **@file mentions** to reference workspace files inline
- **Shift+Enter** for multi-line input
- **Context management** — automatic compaction when conversation gets long
- **Token tracking** — see context usage in the status bar
- **Tool activity streaming** — see what the agent is doing in real-time
- **Review queue** — risky edits require your approval before applying

## Development

```bash
git clone https://github.com/gangj277/open-research.git
cd open-research
npm install
npm run dev        # Run in dev mode
npm test           # Run tests
npm run build      # Build for production
```

## License

MIT
