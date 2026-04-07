## Project overview
TypeScript/Node local-first research agent with a CLI + Ink/React TUI. It supports authenticated OpenAI-backed assistance, academic discovery, workspace/session management, skill plugins, memory persistence, LaTeX drafting/preview, and artifact-based note/edit workflows.

## Key files
- `src/cli.ts` — CLI entrypoint, command routing, startup flow
- `src/tui/` — interactive terminal UI
- `src/lib/agent/` — orchestration, prompts, tools, runtime, state, subagents
- `src/lib/llm/` — provider abstraction and OpenAI-backed auth implementation
- `src/lib/discovery/` — OpenAlex / Semantic Scholar / arXiv search integrations
- `src/lib/workspace/` — workspace init, scan, sources, sessions
- `src/lib/auth/` — login/import/store/status
- `src/lib/memory/` — long-term memory store and extraction
- `src/lib/skills/` — built-in and user-defined skill system, including skill creation helpers
- `src/lib/preview/` — local LaTeX preview helpers
- `builtin-skills/` — packaged workflows/skills; `/devils-advocate` is a critical-review skill that stress-tests claims and actively searches for counter-evidence
- `artifacts/` — generated/edit-proposed markdown artifacts; current edit workflow appears to route note/file edits here
- `tests/` — automated tests
- `docs/` — documentation
- `assets/` — images/binary assets
- `package.json`, `tsconfig.json`, `README.md` — project config/docs

## Current state
The repo is a working TypeScript/Node terminal research agent, not a prototype. The startup flow is: `src/cli.ts` ensures config, resolves workspace, checks provider readiness, and launches the Ink app; the CLI is mostly a thin launcher plus command surface. The main runtime path is the streaming agent loop in `src/lib/agent/runtime.ts`, which builds prompts, injects workspace context and memories, calls a provider, executes tool calls, and iterates to a final response. The strongest areas are the CLI/TUI flow, tool-executing agent loop, workspace abstraction, and skill/discovery extensions. The main architectural complexity sits in `src/lib/agent/` and `src/tui/app.tsx`. File edit/create behavior may be mediated through an artifact/proposal layer rather than direct writes to `notes/`.

## Research direction
Next useful steps are to deepen the architecture map from the ingested corpus, inspect key runtime paths in `src/`, compare behavior against tests, and summarize the main user flows and extension points. Also worth tracing the artifact routing path for create/edit workflows to understand how markdown files are persisted versus proposed.