import fs from "node:fs/promises";
import path from "node:path";
import { loadWorkspaceProject } from "./project";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".tex",
  ".yaml",
  ".yml",
  ".csv",
]);

export interface WorkspaceScanResult {
  workspaceDir: string;
  files: Array<{ key: string; label: string; path: string; content: string }>;
}

const IGNORED_DIRS = new Set([
  ".open-research", "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", ".cache", "target", ".tox",
  "coverage", ".nyc_output", ".parcel-cache", ".turbo",
]);

async function walkDir(rootDir: string, currentDir: string, out: WorkspaceScanResult["files"]) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      await walkDir(rootDir, fullPath, out);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    out.push({
      key: `path:${relativePath}`,
      label: relativePath,
      path: relativePath,
      content: await fs.readFile(fullPath, "utf8"),
    });
  }
}

export async function scanWorkspace(workspaceDir: string): Promise<WorkspaceScanResult> {
  const resolved = path.resolve(workspaceDir);
  const project = await loadWorkspaceProject(resolved);
  if (!project) {
    throw new Error("Not an Open Research workspace. Run `open-research init` first.");
  }
  const files: WorkspaceScanResult["files"] = [];
  await walkDir(resolved, resolved, files);
  return {
    workspaceDir: resolved,
    files,
  };
}
