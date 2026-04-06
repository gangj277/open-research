import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

// ── Render Options ──────────────────────────────────────────────────────────

export interface RenderMarkdownOptions {
  /** Base directory for resolving relative file paths. Defaults to cwd. */
  baseDir?: string;
}

// ── OSC 8 Terminal Hyperlinks ───────────────────────────────────────────────

const FILE_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".r", ".R", ".tex", ".bib",
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv",
  ".sh", ".bash", ".zsh", ".sql", ".html", ".css", ".xml",
  ".pdf", ".png", ".jpg", ".svg", ".gif",
  ".cfg", ".ini", ".env", ".lock", ".log",
]);

// Cache stat results to avoid repeated sync I/O during rendering
const linkCache = new Map<string, string | null>();

// Strip :line or :line:col suffix
const LOCATION_SUFFIX_RE = /^(.*?)(:\d+(?::\d+)?)$/;

function splitLocation(text: string): { filePath: string; location: string } {
  const trimmed = text.trim();
  const match = trimmed.match(LOCATION_SUFFIX_RE);
  if (match && match[1]) {
    return { filePath: match[1], location: match[2] };
  }
  return { filePath: trimmed, location: "" };
}

function looksLikeFilePath(text: string): boolean {
  const { filePath } = splitLocation(text);
  if (filePath.length < 3 || filePath.length > 260) return false;
  if (filePath.includes("\n")) return false;
  // Skip URLs
  if (/^[a-z]+:\/\//i.test(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (FILE_EXTENSIONS.has(ext)) return true;
  if (filePath.includes("/") || filePath.includes("\\")) return true;
  return false;
}

function fileLink(displayText: string, rawText: string, baseDir: string): string {
  const { filePath } = splitLocation(rawText);
  const candidate = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(baseDir, filePath);

  // Check cache first (avoids repeated statSync during render)
  let resolved = linkCache.get(candidate);
  if (resolved === undefined) {
    try {
      resolved = fs.realpathSync(candidate);
    } catch {
      resolved = null;
    }
    linkCache.set(candidate, resolved);
  }

  if (!resolved) return displayText;

  const uri = pathToFileURL(resolved).href;
  return `\x1b]8;;${uri}\x1b\\${displayText}\x1b]8;;\x1b\\`;
}

// Bare path pattern for fallback (paths not in backticks)
const BARE_PATH_RE = /((?:\.{1,2}\/|\/)[^\s`),;\]]+\.[a-zA-Z0-9]{1,6})/g;

// ── Markdown Renderer ───────────────────────────────────────────────────────

/**
 * Lightweight terminal markdown renderer.
 * File paths in code spans and bare paths are Cmd+Clickable via OSC 8.
 */
export function renderMarkdown(text: string, options: RenderMarkdownOptions = {}): string {
  if (!text || !text.trim()) return text;

  const baseDir = options.baseDir ?? process.cwd();

  // Quick check: if no markdown syntax or file paths, return as-is
  if (!/[*_`#\[\]>~\-]/.test(text) && !text.includes("```") && !BARE_PATH_RE.test(text)) {
    return text;
  }

  const lines = text.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    // Code block toggle
    if (line.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        const label = codeBlockLang ? chalk.gray.dim(` ${codeBlockLang} `) : "";
        output.push(chalk.gray("┌" + "─".repeat(40) + label));
        for (const cl of codeBlockLines) {
          output.push(chalk.gray("│ ") + chalk.white(cl));
        }
        output.push(chalk.gray("└" + "─".repeat(40)));
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockLines = [];
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInline(headingMatch[2], baseDir);
      if (level === 1) output.push(chalk.bold.cyan(content));
      else if (level === 2) output.push(chalk.bold.white(content));
      else output.push(chalk.bold(content));
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      output.push(chalk.gray("─".repeat(40)));
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith("> ")) {
      const content = renderInline(line.replace(/^\s*>\s?/, ""), baseDir);
      output.push(chalk.gray("│ ") + chalk.italic(content));
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.+)$/);
    if (ulMatch) {
      output.push(`${ulMatch[1]}${chalk.gray("•")} ${renderInline(ulMatch[2], baseDir)}`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      output.push(`${olMatch[1]}${chalk.gray(olMatch[2] + ".")} ${renderInline(olMatch[3], baseDir)}`);
      continue;
    }

    // Regular paragraph line
    output.push(renderInline(line, baseDir));
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    output.push(chalk.gray("┌" + "─".repeat(40)));
    for (const cl of codeBlockLines) {
      output.push(chalk.gray("│ ") + chalk.white(cl));
    }
    output.push(chalk.gray("└" + "─".repeat(40)));
  }

  return output.join("\n");
}

/**
 * Render inline markdown: bold, italic, code (with file links), links, strikethrough.
 */
function renderInline(text: string, baseDir: string): string {
  let result = text;

  // Code spans — file paths get clickable links
  result = result.replace(/`([^`]+)`/g, (_, code: string) => {
    if (looksLikeFilePath(code)) {
      return fileLink(chalk.cyan.underline(code), code, baseDir);
    }
    return chalk.cyan(code);
  });

  // Bold + italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t));
  result = result.replace(/___(.+?)___/g, (_, t) => chalk.bold.italic(t));

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  result = result.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));

  // Italic
  result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_, t) => chalk.italic(t));
  result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_, t) => chalk.italic(t));

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));

  // Links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    chalk.blue(label) + chalk.gray.dim(` (${url})`)
  );

  // Bare file paths fallback (paths not in backticks that the LLM missed)
  result = result.replace(BARE_PATH_RE, (match) => {
    if (looksLikeFilePath(match)) {
      return fileLink(chalk.cyan.underline(match), match, baseDir);
    }
    return match;
  });

  return result;
}
