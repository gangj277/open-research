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

It has tools that coding agents don't: federated academic paper search, PDF extraction, source-grounded synthesis, and pluggable research skills (devil's advocate, methodology critic, experiment designer, etc.).

Everything stays local. Your workspace is a directory with `sources/`, `notes/`, `papers/`, `experiments/`. The agent reads and writes to it. Risky edits go to a review queue.

## Skills

Built-in research methodologies. Type `/skill-name` to activate:

- **source-scout** — find citation gaps, discover papers
- **devils-advocate** — stress-test claims and assumptions
- **methodology-critic** — critique research methodology
- **evidence-adjudicator** — evaluate evidence quality
- **experiment-designer** — design experiments
- **draft-paper** — draft LaTeX papers from workspace evidence
- **paper-explainer** — explain complex papers
- **synthesis-updater** — update syntheses with new findings

Create custom skills in `~/.open-research/skills/`.

## Tools

| Tool | Description |
|---|---|
| `read_file` | Read any file with streaming, binary detection |
| `read_pdf` | Extract text from PDFs |
| `run_command` | Shell execution — Python, R, LaTeX, anything |
| `list_directory` | Explore directory trees |
| `search_external_sources` | arXiv + Semantic Scholar + OpenAlex |
| `fetch_url` | Fetch web pages and APIs |
| `write_new_file` | Create workspace files |
| `update_existing_file` | Edit with review policy |
| `ask_user` | Pause and ask for clarification |
| `search_workspace` | Full-text search across files |
| `create_paper` | Create LaTeX drafts |

## Development

```bash
git clone https://github.com/gangj277/open-research.git
cd open-research
npm install
npm run dev          # dev mode
npm test             # 63 tests
npm run build        # production build
```

## License

MIT
