<p align="center">
  <img src="assets/hero-banner.png" alt="Open Research — Research-native CLI agent" width="800" />
</p>

<h1 align="center">Open Research</h1>

<p align="center">
  <strong>The research-native CLI.</strong> Like Cursor or Claude Code, but built from the ground up for researchers.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/open-research"><img src="https://img.shields.io/npm/v/open-research.svg" alt="npm version" /></a>
  <a href="https://github.com/gangj277/open-research/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/open-research.svg" alt="license" /></a>
  <a href="https://www.npmjs.com/package/open-research"><img src="https://img.shields.io/npm/dm/open-research.svg" alt="downloads" /></a>
</p>

---

Coding agents changed how developers work. **Open Research does the same for researchers.**

It's a terminal-native agent that understands the research workflow: discover papers, read PDFs, run analysis scripts, synthesize findings, and draft publications — all from one local workspace, grounded in your actual sources.

<p align="center">
  <img src="assets/workflow-concept.png" alt="Research workflow — papers, analysis, synthesis, code" width="700" />
</p>

## Install

Requires Node.js 20+.

**curl**
```bash
curl -fsSL https://raw.githubusercontent.com/gangj277/open-research/main/install.sh | bash
```

**npm**
```bash
npm install -g open-research
```

**bun**
```bash
bun install -g open-research
```

**pnpm**
```bash
pnpm add -g open-research
```

**npx** (no install, runs latest)
```bash
npx open-research
```

## Quick Start

```bash
open-research              # Launch the TUI
/auth                      # Connect your OpenAI account
/init                      # Initialize a workspace
```

Then ask anything:

```
> Find the 10 most-cited papers on transformer attention mechanisms published after 2022,
  summarize their key contributions, and identify gaps in the literature.
```

The agent will search arXiv, Semantic Scholar, and OpenAlex, read the papers, write structured notes, and produce a grounded synthesis — all in your local workspace.

## Why Research-Native?

General-purpose coding agents don't understand research. They can't search academic databases, don't know what a citation gap is, and aren't designed for source-grounded synthesis.

Open Research is different:

| Capability | General coding agent | Open Research |
|---|---|---|
| Search academic papers | No | arXiv + Semantic Scholar + OpenAlex |
| Read PDFs | No | Full text extraction |
| Run analysis code | Sometimes | Python, R, LaTeX, anything via shell |
| Source-grounded writing | No | Every claim traced to workspace evidence |
| Research skills | No | 9 built-in methodologies (devils-advocate, source-scout, etc.) |
| Review queue | Varies | Risky edits require explicit approval |
| Local-first | Varies | All data stays in your workspace directory |

## Tools

The agent has full access to your filesystem and shell:

| Tool | What it does |
|---|---|
| `read_file` | Read any file — text, with binary detection, streaming for large files |
| `read_pdf` | Extract text from PDFs with page-range selection |
| `run_command` | Execute shell commands — Python, R, LaTeX, curl, git, anything |
| `list_directory` | Explore directory trees with depth control |
| `search_external_sources` | Federated search across arXiv, Semantic Scholar, OpenAlex |
| `fetch_url` | Fetch web pages and APIs, HTML auto-converted to text |
| `write_new_file` | Create new workspace files |
| `update_existing_file` | Edit existing files with review policy |
| `ask_user` | Pause and ask you a question when clarification is needed |
| `search_workspace` | Full-text search across workspace files |
| `load_skill` | Activate research skills for specialized workflows |
| `create_paper` | Create LaTeX paper drafts |

## Research Skills

Skills are pluggable research methodologies that guide the agent. Type `/skill-name` to activate:

| Skill | What it does |
|---|---|
| **source-scout** | Find citation gaps, discover relevant papers |
| **devils-advocate** | Stress-test claims, find counter-evidence |
| **methodology-critic** | Critique research methodology |
| **evidence-adjudicator** | Evaluate evidence quality and strength |
| **experiment-designer** | Design experiments and studies |
| **draft-paper** | Draft LaTeX papers grounded in workspace evidence |
| **paper-explainer** | Explain complex papers clearly |
| **synthesis-updater** | Update research syntheses with new findings |
| **skill-creator** | Create your own custom skills |

Create custom skills in `~/.open-research/skills/` — each is just a markdown file with a prompt.

## Commands

| Command | Description |
|---|---|
| `/auth` | Connect OpenAI account via browser |
| `/auth-codex` | Import existing Codex CLI auth |
| `/init` | Initialize workspace in current directory |
| `/skills` | List available research skills |
| `/config` | View or change settings |
| `/clear` | Start a new conversation |
| `/help` | Show all commands |

## Workspace

```
my-research/
  sources/         # PDFs, papers, raw data
  notes/           # Research notes and briefs
  artifacts/       # Generated outputs
  papers/          # LaTeX paper drafts
  experiments/     # Analysis scripts and results
  .open-research/  # Workspace metadata
```

## Features

- **Markdown rendering** — bold, italic, code blocks, headings rendered natively in terminal
- **Slash command autocomplete** — arrow-key navigable dropdown with skills and commands
- **@file mentions** — reference workspace files inline in your prompts
- **Shift+Enter** — multi-line input
- **Context management** — automatic compaction when conversation history gets long
- **Token tracking** — see context window usage in the status bar
- **Tool activity streaming** — see what the agent is doing in real-time
- **Review queue** — risky edits require your approval before applying
- **Update notifications** — automatic check for new versions on launch

## Development

```bash
git clone https://github.com/gangj277/open-research.git
cd open-research
npm install
npm run dev        # Run in dev mode
npm test           # Run tests (63 tests)
npm run build      # Build for production
```

## License

MIT
