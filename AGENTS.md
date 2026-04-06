## Project overview
TypeScript/Node app with a CLI + TUI frontend. Codebase is organized around agent/runtime tooling, auth, discovery/search, and workspace/session handling.

## Key files
- `src/cli.ts` — CLI entrypoint
- `src/tui/` — TUI frontend
- `src/lib/agent/...` — agent/runtime/tools logic
- `src/lib/auth/...` — authentication
- `src/lib/discovery/...` — discovery/search
- `src/lib/workspace/...` — workspace/session handling
- `tests/` — tests
- `docs/` — documentation
- `builtin-skills/` — built-in skills
- `assets/` — images/binary assets
- `package.json`, `tsconfig.json`, `README.md` — project config/docs

## Current state
Workspace has been scanned at a file-system level; no code was modified. Identified both source directories and non-text assets such as `assets/hero-banner.png` and `assets/workflow-concept.png`.

## Research direction
Next useful steps are to read and summarize the codebase in layers: full source, then tests/docs, or produce a file-by-file architecture map.