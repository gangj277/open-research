import fs from "node:fs/promises";
import path from "node:path";
import type { LLMProvider } from "@/lib/llm/provider";
import { readAgentsMd, writeAgentsMd } from "./agents-md";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", ".cache", "target", ".open-research", "coverage",
]);

const INTERESTING_FILES = new Set([
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
  "requirements.txt", "setup.py", "setup.cfg",
  "README.md", "README.txt", "readme.md",
  "Makefile", "Dockerfile", "docker-compose.yml",
  ".env.example", "tsconfig.json", "vitest.config.ts", "jest.config.js",
  "AGENTS.md",
]);

interface FileInfo {
  path: string;
  size: number;
  isDir: boolean;
}

async function scanDirectoryShallow(dir: string, maxDepth = 2, depth = 0): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  if (depth > maxDepth) return results;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && depth === 0 && entry.isDirectory()) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(dir, fullPath);

      if (entry.isDirectory()) {
        results.push({ path: relativePath + "/", size: 0, isDir: true });
        const children = await scanDirectoryShallow(fullPath, maxDepth, depth + 1);
        results.push(...children);
      } else {
        const stat = await fs.stat(fullPath).catch(() => null);
        results.push({ path: relativePath, size: stat?.size ?? 0, isDir: false });
      }
    }
  } catch { /* permission errors etc */ }

  return results;
}

async function readKeyFiles(dir: string): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  for (const name of INTERESTING_FILES) {
    try {
      const content = await fs.readFile(path.join(dir, name), "utf8");
      contents[name] = content.slice(0, 2000);
    } catch { /* doesn't exist */ }
  }
  return contents;
}

const CREATE_PROMPT = `You are creating an AGENTS.md file for a research workspace. This file is injected into an AI research agent's system prompt every session to give it instant project context.

Write a concise AGENTS.md covering:
## Project Overview — What is this project? What research?
## Structure — Key directories and their purpose (only important ones)
## Key Files — Notable files and what they do
## Research Context — What research is in progress?
## Development — How to build/run/test (if applicable)

Rules:
- Under 1500 characters. This goes into every system prompt.
- Specific to THIS project. No generic advice.
- Markdown with ## headings.`;

const UPDATE_PROMPT = `You are updating an existing AGENTS.md file for a research workspace. This file is injected into an AI research agent's system prompt every session.

You have:
1. The CURRENT AGENTS.md content
2. A fresh scan of the workspace directory and key files

Your job: compare the current AGENTS.md against the actual workspace state. Update it to reflect reality:
- Add new directories/files that appeared
- Remove references to things that no longer exist
- Update descriptions that are now outdated
- Preserve any manually-added notes or context the user wrote
- Keep the same ## heading structure

If AGENTS.md is already accurate, output it unchanged.

Rules:
- Under 1500 characters. This goes into every system prompt.
- Output the FULL updated AGENTS.md content, not a diff.
- Markdown with ## headings.`;

/**
 * Generate or update AGENTS.md by scanning the workspace.
 * If AGENTS.md exists, reads it and updates intelligently.
 * If it doesn't exist, creates it from scratch.
 */
export async function generateInitialAgentsMd(input: {
  workspaceDir: string;
  provider: LLMProvider;
  model?: string;
}): Promise<string> {
  const dir = input.workspaceDir;

  // Scan workspace
  const files = await scanDirectoryShallow(dir);
  const tree = files
    .slice(0, 100)
    .map((f) => `${f.isDir ? "d" : "f"} ${f.path}${f.size > 0 ? ` (${(f.size / 1024).toFixed(1)}KB)` : ""}`)
    .join("\n");

  const keyFiles = await readKeyFiles(dir);
  const keyFileText = Object.entries(keyFiles)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n");

  const scanData = `Directory: ${dir}\n\nFile tree:\n${tree}\n\n${keyFileText || "No recognizable key files found."}`;

  // Check if AGENTS.md already exists
  const existing = await readAgentsMd(dir);

  let systemPrompt: string;
  let userMessage: string;

  if (existing) {
    // Update mode
    systemPrompt = UPDATE_PROMPT;
    userMessage = `Current AGENTS.md:\n---\n${existing}\n---\n\nFresh workspace scan:\n${scanData.slice(0, 25000)}`;
  } else {
    // Create mode
    systemPrompt = CREATE_PROMPT;
    userMessage = scanData.slice(0, 25000);
  }

  const response = await input.provider.callLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    model: input.model ?? "gpt-5.4-mini",
    maxTokens: 2048,
    temperature: 0,
  });

  const content = response.content
    .replace(/^```(?:markdown)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  await writeAgentsMd(dir, content);
  return content;
}
