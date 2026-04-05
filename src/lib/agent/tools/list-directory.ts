import fs from "node:fs/promises";
import path from "node:path";

const MAX_ENTRIES = 200;

const DEFAULT_IGNORE = new Set([
  "node_modules",
  "__pycache__",
  ".git",
  ".open-research",
  "dist",
  "build",
  "target",
  ".next",
  ".cache",
  ".venv",
  "venv",
  ".env",
]);

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
}

async function listEntries(dirPath: string, ignore: Set<string>): Promise<DirEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: DirEntry[] = [];

  for (const entry of entries) {
    if (ignore.has(entry.name) || entry.name.startsWith(".") && DEFAULT_IGNORE.has(entry.name)) {
      continue;
    }
    let size = 0;
    if (!entry.isDirectory()) {
      try {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        size = stat.size;
      } catch {
        // skip stat errors
      }
    }
    results.push({
      name: entry.name,
      isDir: entry.isDirectory(),
      size,
    });
  }

  // Directories first, then files, both alphabetical
  results.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function walkTree(
  rootDir: string,
  currentDir: string,
  depth: number,
  maxDepth: number,
  ignore: Set<string>,
  lines: string[],
  indent: string,
  counter: { count: number }
): Promise<void> {
  if (counter.count >= MAX_ENTRIES) return;
  if (depth > maxDepth) return;

  const entries = await listEntries(currentDir, ignore);

  for (const entry of entries) {
    if (counter.count >= MAX_ENTRIES) {
      lines.push(`${indent}... (truncated at ${MAX_ENTRIES} entries)`);
      return;
    }
    counter.count++;

    if (entry.isDir) {
      lines.push(`${indent}${entry.name}/`);
      if (depth < maxDepth) {
        await walkTree(
          rootDir,
          path.join(currentDir, entry.name),
          depth + 1,
          maxDepth,
          ignore,
          lines,
          indent + "  ",
          counter
        );
      }
    } else {
      const size = formatSize(entry.size);
      lines.push(`${indent}${entry.name}${size ? `  (${size})` : ""}`);
    }
  }
}

/**
 * List directory contents as a tree with optional depth control.
 */
export async function executeListDirectory(
  args: {
    dir_path?: string;
    depth?: number;
    ignore?: string[];
  }
): Promise<string> {
  const dirPath = args.dir_path
    ? (path.isAbsolute(args.dir_path) ? args.dir_path : path.resolve(args.dir_path))
    : process.cwd();
  const maxDepth = Math.min(args.depth ?? 2, 5);
  const ignore = new Set([...DEFAULT_IGNORE, ...(args.ignore ?? [])]);

  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      return `Error: ${dirPath} is not a directory.`;
    }
  } catch {
    return `Error: Directory not found: ${dirPath}`;
  }

  const lines: string[] = [`${dirPath}/`];
  const counter = { count: 0 };
  await walkTree(dirPath, dirPath, 0, maxDepth, ignore, lines, "  ", counter);

  return lines.join("\n");
}
