<p align="center">
  <img src="assets/hero-banner.png" alt="Open Research" width="720" />
</p>

<h3 align="center">The research-native CLI agent.</h3>

<p align="center">
  <a href="https://open-research.info">open-research.info</a> &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/open-research"><img src="https://img.shields.io/npm/v/open-research.svg" alt="npm" /></a>
  <a href="https://github.com/gangj277/open-research/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/open-research.svg" alt="license" /></a>
</p>

<p align="center">
  <img src="assets/workflow-concept.png" alt="Papers → Analysis → Synthesis → Code" width="620" />
</p>

## Install

```bash
# npm
npm install -g open-research
```

```bash
# bun
bun install -g open-research
```

```bash
# pnpm
pnpm add -g open-research
```

```bash
# npx (no install)
npx open-research
```

> [!TIP]
> Requires Node.js 20+. Run `node -v` to check.

## Usage

```bash
open-research
```

Inside the TUI:

```
/auth          Connect your OpenAI account
/init          Initialize a workspace
/help          Show all commands
```

Then ask anything:

```
> Find the most-cited papers on transformer attention since 2022
  and identify gaps in the literature
```

The agent searches arXiv, Semantic Scholar, and OpenAlex — reads papers (including PDFs), extracts evidence for and against your research target, runs analysis scripts, writes source-grounded notes, and drafts artifacts in your local workspace.

## How is this different from Cursor / Claude Code?

Those are coding agents. Open Research is a **research agent**.

It has tools that coding agents don't: federated academic paper search with target extraction, web search with evidence analysis, PDF parsing from URLs, a research knowledge graph (ontology), sub-agent delegation, and pluggable research skills.

Everything stays local. Your workspace is a directory with `sources/`, `notes/`, `papers/`, `experiments/`. The agent reads and writes to it. Risky edits go to a review queue.

## Research Ontology

The agent automatically builds a **structured knowledge graph** as you research. Every paper read, claim made, finding extracted, and method discovered gets captured as typed, connected notes.

### How it works

You don't manage the ontology manually — it emerges from conversation:

1. **After each turn**, a background ontology manager extracts knowledge from the conversation and tool outputs
2. **Before each turn**, a relevance agent selects notes related to your current question and injects them as context
3. **During a turn**, the agent can query the ontology for evidence, contradictions, and connections

### Note types

| Kind | What it captures |
|------|-----------------|
| `source` | Citable origin — paper, URL, dataset, book |
| `finding` | Specific result extracted from a source |
| `claim` | Argument or assertion in the research |
| `question` | Open gap, uncertainty, research question |
| `method` | Methodology or analytical technique |
| `insight` | Synthesis connecting multiple findings |

### Connections

Notes are linked with typed edges: `supports`, `contradicts`, `derived-from`, `relates-to` — each with a strength (strong/moderate/weak) and a context explaining *why* the connection exists.

### Slash commands

```
/ontology                 Overview — note counts, contradictions, open questions
/ontology claims          List all claims with evidence counts
/ontology conflicts       Show all contradiction pairs
/ontology around <term>   Find notes related to a topic with their edges
/ontology delete <id>     Remove a note and its edges
```

### Agent tools

| Tool | What it does |
|------|-------------|
| `query_ontology` | Ask research questions — a sub-agent traverses the graph and returns a synthesized answer |
| `ontology_status` | Get a snapshot: note counts, contradictions, unsupported claims, open questions |

## Search with Target Extraction

Both search tools use a **target extraction pipeline**: discover sources → fetch content (PDFs, HTML, abstracts) → extract evidence with gpt-5.4-mini → return structured findings. The main agent never sees raw page content.

### Academic search

```
search_external_sources(
  target: "What speedups do efficient attention methods achieve",
  searches: [{ query: "transformer attention efficiency" }]
)
```

Returns structured findings per paper:
- **Supports**: Evidence supporting your target
- **Contradicts**: Evidence challenging your target
- **Related**: Relevant context (methods, definitions, frameworks)
- **Summary**: One-paragraph synthesis
- **Relevance score**: 0-10

The pipeline handles PDFs from URLs (arXiv, open access journals) — downloads, parses via pdfjs, extracts text from the first 5 pages. arXiv papers use the abstract directly (zero network cost).

### Web search

```
web_search(
  target: "Best practices for PyTorch DataLoader multi-GPU",
  query: "pytorch dataloader num_workers multi gpu"
)
```

Same extraction pipeline, different discovery backend:
- **Default**: DuckDuckGo HTML scraping (zero config, no API key)
- **Upgrade**: Brave Search API for better results — set via `/api-keys brave <key>` (~1,000 free queries/month)

## Agent Modes

Three modes. Cycle with `Shift+Tab`:

- **Manual Review** (default) — agent proposes changes, you accept (`a`) or reject (`r`)
- **Auto-Approve** — all file writes applied immediately
- **Auto-Research** — two-phase: planning (produces a Research Charter) → autonomous execution

## Sub-Agents

The main agent delegates exploration to lightweight sub-agents running on their own context window.

The **explore** sub-agent (gpt-5.4-mini, high reasoning) has read-only tools and returns concise findings. The main agent gets answers without burning its context on raw file reads.

## Task Tracking

For multi-step research, the agent creates a visible task checklist:

```
  ⠋ Searching for chain-of-thought papers...
  ○ Read and extract from top papers
  ○ Build comparison table
  ✓ 1 completed
```

Tasks are injected into the agent's context on every turn — it always knows what it's done and what's next. Toggle with `Ctrl+T`.

## Research Skills

Skills are pluggable research methodologies. Type `/<skill-name>` to activate.

### Ideation & Discovery

| Skill | What it does |
|---|---|
| **`/novelty-checker`** | Quick "has this been done?" assessment with verdict: Novel, Partially novel, Incremental, or Already done. |
| **`/source-scout`** | Finds papers the workspace is missing with gap analysis and prioritized scout report. |
| **`/paper-explainer`** | Single paper deep read with red flags, or multi-paper comparison table (Elicit-style). |

### Critical Evaluation

| Skill | What it does |
|---|---|
| **`/devils-advocate`** | Stress-tests claims through six lenses. Actively searches for counter-evidence. |
| **`/methodology-critic`** | Reviews study design, statistical methods, reproducibility. Rates Rigorous to Flawed. |
| **`/evidence-adjudicator`** | Judges conflicting claims using formal evidence hierarchy. Delivers verdict with ratings. |

### Analysis & Experimentation

| Skill | What it does |
|---|---|
| **`/experiment-designer`** | Autonomous proof engine: hypothesis → experiment → code → run → iterate. |
| **`/data-analyst`** | End-to-end statistical analysis with mandatory effect sizes and confidence intervals. |

### Writing & Revision

| Skill | What it does |
|---|---|
| **`/draft-paper`** | Drafts publication-quality LaTeX with BibTeX from workspace sources. |
| **`/reviewer-response`** | Parses peer review, generates point-by-point response letter with revision tracking. |

### Meta

| Skill | What it does |
|---|---|
| **`/skill-creator`** | Create custom skills with full format guide and validation. |

## Memory

The agent learns about you automatically — research field, preferred tools, methodological preferences.

Two levels:
- **Global** (`~/.open-research/memory.json`) — your profile, preferences
- **Project** (`<workspace>/.open-research/memory.json`) — project-specific context

```
/memory              View stored memories
/memory clear        Delete everything
/memory delete <id>  Remove one
```

## Live LaTeX Preview

```
/preview papers/draft.tex
```

Opens a localhost server with KaTeX math, auto-reload on file changes, and dark theme. No LaTeX installation required.

## Tools

| Tool | Description |
|---|---|
| `read_file` | Read any file — streaming, binary detection, `~` expansion |
| `read_pdf` | Extract text from PDFs with page-range selection |
| `run_command` | Shell execution — Python, R, LaTeX, curl, git, anything |
| `list_directory` | Explore directory trees with depth control |
| `search_external_sources` | Academic search with target extraction (arXiv + Semantic Scholar + OpenAlex) |
| `web_search` | Web search with target extraction (DuckDuckGo or Brave) |
| `fetch_url` | Fetch a specific URL, HTML auto-converted to text |
| `write_new_file` | Create workspace files |
| `update_existing_file` | Edit existing files with review policy |
| `ask_user` | Pause and ask the user a question |
| `search_workspace` | Full-text search across workspace files |
| `create_paper` | Create LaTeX paper drafts |
| `load_skill` | Activate a research skill |
| `launch_subagent` | Delegate tasks to lightweight sub-agents |
| `create_tasks` | Create a research task checklist |
| `update_task` | Update task status and details |
| `query_ontology` | Query the research knowledge graph |
| `ontology_status` | Get ontology overview — notes, contradictions, gaps |

## Commands

| Command | Description |
|---|---|
| `/auth` | Connect OpenAI account via browser |
| `/init` | Initialize workspace in current directory |
| `/skills` | List available research skills |
| `/ontology` | View or manage the research ontology |
| `/preview <file>` | Live-preview a LaTeX file in browser |
| `/memory` | View or manage stored memories |
| `/api-keys` | Set API keys (Semantic Scholar, OpenAlex, Brave) |
| `/config` | Settings (model, theme, mode, apikey) |
| `/compact` | Compress conversation to save context |
| `/cost` | Token usage for the session |
| `/context` | Context window usage |
| `/btw` | Side question without affecting main conversation |
| `/export` | Export conversation as markdown |
| `/diff` | Files changed this session |
| `/doctor` | Diagnose auth, connectivity, tools |
| `/resume` | Resume a previous session |
| `/clear` | Start fresh |
| `/help` | Show all commands |

## Workspace

```
my-research/
  sources/         # PDFs, papers, raw data
  notes/           # Research notes, syntheses, reviews
  artifacts/       # Generated outputs
  papers/          # LaTeX paper drafts
  experiments/     # Analysis scripts, results, hypotheses
  .open-research/
    AGENTS.md      # Auto-generated project context
    ontology.json  # Research knowledge graph
    tasks.json     # Task tracking state
    memory.json    # Project-scoped memories
    sessions/      # Chat history
```

## Features

- **Research ontology** — automatic knowledge graph that captures sources, findings, claims, contradictions, and connections as you work
- **Target extraction search** — academic and web search that returns structured evidence (supports/contradicts/related), not raw pages
- **PDF parsing from URLs** — fetches and extracts text from academic PDFs directly during search
- **Task tracking** — visible checklist for multi-step work, injected into agent context every turn
- **Sub-agent delegation** — explore agent navigates the workspace on its own context, returns summaries
- **Init banner** — version, model, context window, workspace info at launch
- **Terminal markdown** — bold, italic, code blocks, headings rendered natively
- **Autocomplete** — commands, skills, and @file mentions in a scrollable dropdown
- **Condensed tool activity** — grouped summary per turn, Ctrl+O to expand
- **Slash command highlighting** — commands appear in blue as you type
- **Context management** — automatic two-phase compaction at 90% of context window
- **Token tracking** — context usage in the status bar
- **Two-tier memory** — global + project-level, selective retrieval per turn
- **AGENTS.md** — auto-generated project context, injected into system prompt

## Development

```bash
git clone https://github.com/gangj277/open-research.git
cd open-research
npm install
npm run dev          # dev mode
npm test             # tests
npm run build        # production build
```

## License

MIT
