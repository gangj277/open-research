<p align="center">
  <img src="assets/hero-banner.png" alt="Open Research" width="720" />
</p>

<h3 align="center">The research-native CLI agent.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/open-research"><img src="https://img.shields.io/npm/v/open-research.svg" alt="npm" /></a>
  <a href="https://github.com/gangj277/open-research/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/open-research.svg" alt="license" /></a>
</p>

<p align="center">
  <img src="assets/workflow-concept.png" alt="Papers → Analysis → Synthesis → Code" width="620" />
</p>

## Install

```bash
# curl
curl -fsSL https://raw.githubusercontent.com/gangj277/open-research/main/install.sh | bash
```

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

The agent searches arXiv, Semantic Scholar, and OpenAlex — reads papers, runs analysis scripts, writes source-grounded notes, and drafts artifacts in your local workspace.

## How is this different from Cursor / Claude Code?

Those are coding agents. Open Research is a **research agent**.

It has tools that coding agents don't: federated academic paper search, PDF extraction, source-grounded synthesis, sub-agent delegation, and pluggable research skills (novelty checker, experiment designer, reviewer response manager, etc.).

Everything stays local. Your workspace is a directory with `sources/`, `notes/`, `papers/`, `experiments/`. The agent reads and writes to it. Risky edits go to a review queue.

## Agent Modes

Open Research operates in three modes. Cycle with `Shift+Tab`:

### Manual Review (default)

The agent proposes changes. You review and accept (`a`) or reject (`r`) each one. Best for sensitive work where every edit matters.

### Auto-Approve

All file writes are applied immediately without review. Best for exploratory work where speed matters more than control.

### Auto-Research

The most powerful mode. A two-phase autonomous research workflow:

**Phase 1 — Planning.** The agent enters read-only planning mode. It reads your workspace, searches academic databases, and asks you clarifying questions. It then produces a **Research Charter** — a structured contract defining:

- The research question (precisely stated)
- Success criteria (what "done" looks like)
- Scope boundaries (what's explicitly out of scope)
- Known starting points (papers, data, leads)
- Proposed investigation steps

You review the charter and either approve it, send it back for revision, or cancel.

**Phase 2 — Execution.** Once approved, the agent executes the charter autonomously — searching papers, reading sources, running analysis code, writing notes, and producing artifacts. It runs until the success criteria are met or it hits a dead end and reports what it found.

## Sub-Agents

The main agent can delegate exploration tasks to lightweight sub-agents that run on their own context window. This keeps the main agent's context clean and improves token efficiency.

```
launch_subagent(type: "explore", goal: "Find all files related to the auth flow...")
```

The **explore** sub-agent runs on `gpt-5.4-mini` with high reasoning effort. It has read-only tools (`read_file`, `list_directory`, `search_workspace`) and returns a concise, conclusion-oriented summary. The main agent gets the answer without burning its context on raw file reads.

Sub-agents are extensible — new types can be added as config entries without changing the tool schema.

## Research Skills

Skills are pluggable research methodologies — detailed workflow prompts that guide the agent through a specific research task. Type `/<skill-name>` to activate.

### Ideation & Discovery

| Skill | What it does |
|---|---|
| **`/novelty-checker`** | Quick "has this been done?" assessment. Decomposes ideas into technique/domain/claim components, runs 5-8 search variations, and delivers a verdict: Novel, Partially novel, Incremental, or Already done — with closest existing work, white space map, and pivot recommendations. |
| **`/source-scout`** | Systematically finds papers the workspace is missing. Searches with multiple query variations, evaluates relevance by citation count and venue, fetches key papers, produces a prioritized scout report with gap analysis. |
| **`/paper-explainer`** | Two modes: (1) Single paper deep read with structured breakdown including methodological red flags, or (2) Multi-paper comparison table with structured extraction across 6-10 dimensions (Elicit-style) and cross-paper synthesis. |

### Critical Evaluation

| Skill | What it does |
|---|---|
| **`/devils-advocate`** | Stress-tests every claim in the workspace. Attacks each one through six lenses: evidence gap, logical gap, scope overclaim, alternative explanation, replication concern, and statistical concern. Actively searches for counter-evidence. Rates each weakness as Critical/Significant/Minor. |
| **`/methodology-critic`** | Reviews study design, sample selection, controls, measurement validity, statistical methods, and reporting completeness. If code is available, reproduces the analysis to verify results. Rates each study Rigorous/Acceptable/Concerning/Flawed. |
| **`/evidence-adjudicator`** | Judges conflicting claims using a formal evidence hierarchy (meta-analysis → RCT → cohort → case study → opinion). Checks for bias and conflicts of interest. Delivers a clear verdict with evidence ratings: Strong/Moderate/Weak/Insufficient. |

### Analysis & Experimentation

| Skill | What it does |
|---|---|
| **`/experiment-designer`** | Autonomous proof engine. Takes a hypothesis and runs the full loop: formalize → design minimal experiment → write code → run it → analyze results → iterate (up to 5x) until proven or disproven. All artifacts saved to `experiments/` with versioned scripts. |
| **`/data-analyst`** | End-to-end statistical analysis: explore data (distributions, missing values) → clean (with documented decisions) → analyze (appropriate tests, mandatory effect sizes and confidence intervals) → visualize (matplotlib/seaborn) → interpret with honest caveats. |

### Writing & Revision

| Skill | What it does |
|---|---|
| **`/draft-paper`** | Drafts a publication-quality LaTeX paper: gathers workspace evidence → outlines the argument → writes each section (intro through conclusion) → generates BibTeX from sources → self-reviews for unsupported claims and argument flow. |
| **`/reviewer-response`** | Parses peer review comments into numbered items (R1.1, R1.2...), classifies as Major/Minor/Praise/Question, flags contradictions between reviewers, generates a point-by-point response letter with verbatim quotes and specific change locations, and maintains a revision completion checklist. |

### Meta

| Skill | What it does |
|---|---|
| **`/skill-creator`** | Create custom skills in `~/.open-research/skills/`. Full guidance on the SKILL.md format, directory structure, prompt design, and validation — with quality guidelines for writing effective workflow prompts. |

## Memory

The agent learns about you automatically. After each conversation, a background process identifies facts worth remembering — your research field, preferred tools, current projects, methodological preferences.

Memories are stored at two levels:
- **Global** (`~/.open-research/memory.json`) — your profile, preferences, expertise
- **Project** (`<workspace>/.open-research/memory.json`) — project-specific context

Only relevant memories are injected each turn based on query similarity, keeping the context window efficient.

```
/memory              View all stored memories
/memory clear        Delete everything
/memory delete <id>  Remove a specific memory
```

## Live LaTeX Preview

When the agent drafts a paper, preview it instantly:

```
/preview papers/draft.tex
```

Opens a localhost server in your browser with:
- Sections, math (KaTeX), citations, lists rendered as styled HTML
- Auto-reload — the page refreshes every time the file changes
- Dark theme matching the CLI aesthetic
- No LaTeX installation required for preview

For final PDF output, the agent compiles with `pdflatex` or `tectonic` via `run_command`.

## Tools

The agent has 14 tools with full filesystem and shell access:

| Tool | Description |
|---|---|
| `read_file` | Read any file — streaming, binary detection, `~` expansion |
| `read_pdf` | Extract text from PDFs with page-range selection |
| `run_command` | Shell execution — Python, R, LaTeX, curl, git, anything |
| `list_directory` | Explore directory trees with depth control |
| `search_external_sources` | Federated search: arXiv + Semantic Scholar + OpenAlex |
| `fetch_url` | Fetch web pages and APIs, HTML auto-converted to text via cheerio |
| `write_new_file` | Create workspace files |
| `update_existing_file` | Edit existing files with review policy |
| `ask_user` | Pause and ask the user a question with selectable options |
| `search_workspace` | Full-text search across workspace files |
| `create_paper` | Create LaTeX paper drafts |
| `load_skill` | Activate a research skill |
| `read_skill_reference` | Read reference materials from active skills |
| `launch_subagent` | Delegate tasks to lightweight sub-agents with isolated context |

## Commands

| Command | Description |
|---|---|
| `/auth` | Connect OpenAI account via browser |
| `/auth-codex` | Import existing Codex CLI auth |
| `/init` | Initialize workspace in current directory |
| `/skills` | List available research skills |
| `/preview <file>` | Live-preview a LaTeX file in browser |
| `/memory` | View or manage stored memories |
| `/api-keys` | Set API keys for Semantic Scholar, OpenAlex |
| `/config` | View or change settings (model, theme, mode, apikey) |
| `/compact` | Manually compress conversation to save context |
| `/cost` | Show token usage and cost for the session |
| `/context` | Show context window usage — how full it is |
| `/btw` | Ask a side question without affecting the main conversation |
| `/export` | Export conversation as markdown |
| `/diff` | Show files the agent has changed this session |
| `/doctor` | Diagnose auth, connectivity, and tool availability |
| `/resume` | Resume a previous session |
| `/clear` | Start a new conversation |
| `/help` | Show all commands |

## Workspace

```
my-research/
  sources/         # PDFs, papers, raw data
  notes/           # Research notes, syntheses, reviews
  artifacts/       # Generated outputs
  papers/          # LaTeX paper drafts
  experiments/     # Analysis scripts, results, hypotheses
  .open-research/  # Workspace metadata, sessions, project memory
    AGENTS.md      # Auto-generated project context (injected into system prompt)
```

## Features

- **Senior research director persona** — concise, conclusion-oriented responses. Findings first, evidence second.
- **Sub-agent delegation** — explore agent handles codebase navigation on its own context, returns summaries
- **Terminal markdown** — bold, italic, code blocks, headings rendered natively with chalk
- **Autocomplete** — slash commands, skills, and @file mentions in a scrollable arrow-key dropdown
- **Condensed tool activity** — grouped summary per turn instead of per-tool spam, with live progress in footer
- **Shift+Enter** — multi-line input
- **Slash command highlighting** — commands appear in blue as you type
- **Context management** — automatic two-phase compaction at 90% of context window
- **Token tracking** — context usage visible in the status bar (input/output/reasoning/cache breakdown)
- **AGENTS.md** — auto-generated project context file, updated after each turn, injected into system prompt
- **Two-tier memory** — global + project-level, with selective retrieval based on query relevance
- **Update notifications** — checks for new versions on launch

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
