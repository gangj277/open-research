import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import type { WorkspaceContext } from "../state";

const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB total returned to LLM
const MAX_LINE_LENGTH = 2000;
const DEFAULT_LIMIT = 2000;

const BINARY_EXTENSIONS = new Set([
  ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar", ".xz",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".obj",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg", ".tiff",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac", ".ogg",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".wasm", ".pyc", ".class", ".jar",
  ".db", ".sqlite", ".sqlite3",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
]);

function isBinaryByExtension(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function isBinaryByContent(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buf, 0, 4096, 0);
    if (bytesRead === 0) return false;
    const sample = buf.subarray(0, bytesRead);
    if (sample.includes(0)) return true;
    let nonPrintable = 0;
    for (let i = 0; i < bytesRead; i++) {
      const b = sample[i]!;
      if ((b < 9) || (b > 13 && b < 32)) nonPrintable++;
    }
    return nonPrintable / bytesRead > 0.3;
  } finally {
    await handle.close();
  }
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) return line;
  return line.slice(0, MAX_LINE_LENGTH) + `... (truncated to ${MAX_LINE_LENGTH} chars)`;
}

/** Expand ~ to home directory */
function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

/**
 * Stream-read a file from disk. Only reads lines in the requested window.
 * Never loads the entire file into memory.
 */
async function streamReadFile(
  resolved: string,
  offset: number, // 1-indexed
  limit: number
): Promise<{ outputLines: string[]; totalLines: number; bytesCut: boolean }> {
  const startLine = offset; // 1-indexed inclusive
  const endLine = offset + limit - 1; // 1-indexed inclusive

  const outputLines: string[] = [];
  let currentLine = 0;
  let totalBytes = 0;
  let bytesCut = false;

  const stream = createReadStream(resolved, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const rawLine of rl) {
      currentLine++;

      // Before the window — skip
      if (currentLine < startLine) continue;

      // Past the window — keep counting for totalLines
      if (currentLine > endLine) continue;

      // Inside the window
      const line = truncateLine(rawLine);
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (totalBytes + lineBytes > MAX_OUTPUT_BYTES) {
        bytesCut = true;
        break;
      }
      totalBytes += lineBytes;
      outputLines.push(`${currentLine}\t${line}`);
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { outputLines, totalLines: currentLine, bytesCut };
}

/**
 * Read any file by path, with streaming line-by-line read, binary detection, and size guards.
 * Falls back to workspace key lookup for backward compatibility.
 */
export async function executeReadFile(
  args: {
    file_path: string;
    offset?: number;
    limit?: number;
  },
  ctx: WorkspaceContext
): Promise<string> {
  const filePath = expandHome(args.file_path);
  const offset = Math.max(1, args.offset ?? 1);
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);

  // Backward compat: workspace key lookup
  if (filePath.startsWith("path:") && filePath in ctx.workspaceFiles) {
    return formatFromString(filePath, ctx.workspaceFiles[filePath], offset, limit);
  }

  // Resolve path
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

  // Check existence
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    // Fallback to workspace key
    if (filePath in ctx.workspaceFiles) {
      return formatFromString(filePath, ctx.workspaceFiles[filePath], offset, limit);
    }
    return `Error: File not found: ${args.file_path}`;
  }

  // Directory → list contents
  if (stat.isDirectory()) {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const lines = entries
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 100)
      .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}${e.isDirectory() ? "/" : ""}`)
      .join("\n");
    return `<path>${resolved}</path>\n<type>directory</type>\n<content>\n${lines}\n</content>`;
  }

  // Binary check
  if (isBinaryByExtension(resolved) || await isBinaryByContent(resolved)) {
    const sizeKb = (stat.size / 1024).toFixed(1);
    return `<path>${resolved}</path>\n<type>binary</type>\n<size>${sizeKb} KB</size>\nBinary file — cannot display contents. Use run_command to process it.`;
  }

  // Stream-read text file (never loads entire file into memory)
  const { outputLines, totalLines, bytesCut } = await streamReadFile(resolved, offset, limit);

  const shownEnd = offset - 1 + outputLines.length;
  let footer = "";
  if (bytesCut || shownEnd < totalLines) {
    footer = `\n(Showing lines ${offset}-${shownEnd} of ${totalLines}. Use offset=${shownEnd + 1} to continue.)`;
  }

  return `<path>${resolved}</path>\n<lines>${totalLines}</lines>\n<content>\n${outputLines.join("\n")}${footer}\n</content>`;
}

/** Format from an in-memory string (for workspace key fallback) */
function formatFromString(filePath: string, content: string, offset: number, limit: number): string {
  const allLines = content.split("\n");
  const totalLines = allLines.length;
  const startIdx = offset - 1;
  const endIdx = Math.min(startIdx + limit, totalLines);
  const slice = allLines.slice(startIdx, endIdx);

  let byteCount = 0;
  const outputLines: string[] = [];
  let truncated = false;

  for (let i = 0; i < slice.length; i++) {
    const line = truncateLine(slice[i]);
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (byteCount + lineBytes > MAX_OUTPUT_BYTES) {
      truncated = true;
      break;
    }
    byteCount += lineBytes;
    outputLines.push(`${startIdx + i + 1}\t${line}`);
  }

  const shownEnd = startIdx + outputLines.length;
  let footer = "";
  if (truncated || shownEnd < totalLines) {
    footer = `\n(Showing lines ${offset}-${shownEnd} of ${totalLines}. Use offset=${shownEnd + 1} to continue.)`;
  }

  return `<path>${filePath}</path>\n<lines>${totalLines}</lines>\n<content>\n${outputLines.join("\n")}${footer}\n</content>`;
}
