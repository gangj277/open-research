import fs from "node:fs/promises";
import path from "node:path";
import type { LLMProvider } from "@/lib/llm/provider";
import { writeAgentsMd } from "./agents-md";

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
]);

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini",
  ".py", ".ts", ".tsx", ".js", ".jsx", ".r", ".R", ".tex", ".bib",
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
      const relativePath = path.relative(process.cwd(), fullPath);

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
    const filePath = path.join(dir, name);
    try {
      const content = await fs.readFile(filePath, "utf8");
      // Only include first 2000 chars of each file
      contents[name] = content.slice(0, 2000);
    } catch { /* file doesn't exist */ }
  }

  return contents;
}

const INIT_PROMPT = `You are creating an AGENTS.md file for a research workspace. This file will be injected into an AI research agent's system prompt every session to give it instant project context.

Based on the directory structure and key file contents below, write a concise AGENTS.md that covers:

## Project Overview
What is this project about? What type of research?

## Structure
Key directories and what they contain (only the important ones).

## Key Files
Important files and what they do (only the notable ones).

## Research Context
What research appears to be in progress based on the files?

## Development
How to build/run/test (if applicable, based on package.json or similar).

Rules:
- Keep it under 1500 characters total
- Be specific to THIS project, not generic
- If it's unclear what the project does, say so and note what you can see
- Use markdown with ## headings
- Don't include obvious things ("node_modules contains npm packages")`;

/**
 * Scan the workspace and generate an initial AGENTS.md using an LLM.
 */
export async function generateInitialAgentsMd(input: {
  workspaceDir: string;
  provider: LLMProvider;
  model?: string;
}): Promise<string> {
  const dir = input.workspaceDir;

  // Scan directory structure
  const files = await scanDirectoryShallow(dir);
  const tree = files
    .slice(0, 100)
    .map((f) => `${f.isDir ? "d" : "f"} ${f.path}${f.size > 0 ? ` (${(f.size / 1024).toFixed(1)}KB)` : ""}`)
    .join("\n");

  // Read key files
  const keyFiles = await readKeyFiles(dir);
  const keyFileText = Object.entries(keyFiles)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n");

  const userMessage = `Directory: ${dir}\n\nFile tree:\n${tree}\n\n${keyFileText ? `Key files:\n${keyFileText}` : "No recognizable key files found."}`;

  const response = await input.provider.callLLM({
    messages: [
      { role: "system", content: INIT_PROMPT },
      { role: "user", content: userMessage.slice(0, 30000) },
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
