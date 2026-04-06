import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";

// ── OSC 8 Terminal Hyperlinks ───────────────────────────────────────────────
// Makes file paths Cmd+Clickable in supported terminals (iTerm2, Kitty, etc.)

const FILE_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".r", ".R", ".tex", ".bib",
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv",
  ".sh", ".bash", ".zsh", ".sql", ".html", ".css", ".xml",
  ".pdf", ".png", ".jpg", ".svg", ".gif",
  ".cfg", ".ini", ".env", ".lock", ".log",
]);

function looksLikeFilePath(text: string): boolean {
  if (text.length < 3 || text.length > 200) return false;
  if (text.includes(" ") || text.includes("\n")) return false;
  const ext = path.extname(text).toLowerCase();
  if (FILE_EXTENSIONS.has(ext)) return true;
  if (text.includes("/") && !text.startsWith("http")) return true;
  return false;
}

function resolveFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

/** Wrap text in an OSC 8 hyperlink (Cmd+Click opens file in IDE) */
function fileLink(displayText: string, filePath: string): string {
  const absPath = resolveFilePath(filePath);
  // Only link if the file actually exists
  try {
    fs.statSync(absPath);
  } catch {
    return displayText; // File doesn't exist, don't link
  }
  const uri = `file://${absPath}`;
  return `\x1b]8;;${uri}\x1b\\${displayText}\x1b]8;;\x1b\\`;
}

/**
 * Lightweight terminal markdown renderer.
 * Handles: bold, italic, code spans, code blocks, headings, lists, blockquotes, links, horizontal rules.
 * File paths in code spans are Cmd+Clickable via OSC 8 hyperlinks.
 */
export function renderMarkdown(text: string): string {
  if (!text || !text.trim()) return text;

  // Quick check: if no markdown syntax is present, return as-is
  if (!/[*_`#\[\]>~\-]/.test(text) && !text.includes("```")) return text;

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
        // End code block — render collected lines
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
      const content = renderInline(headingMatch[2]);
      if (level === 1) {
        output.push(chalk.bold.cyan(content));
      } else if (level === 2) {
        output.push(chalk.bold.white(content));
      } else {
        output.push(chalk.bold(content));
      }
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      output.push(chalk.gray("─".repeat(40)));
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith("> ")) {
      const content = renderInline(line.replace(/^\s*>\s?/, ""));
      output.push(chalk.gray("│ ") + chalk.italic(content));
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.+)$/);
    if (ulMatch) {
      const indent = ulMatch[1];
      const content = renderInline(ulMatch[2]);
      output.push(`${indent}${chalk.gray("•")} ${content}`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      const indent = olMatch[1];
      const num = olMatch[2];
      const content = renderInline(olMatch[3]);
      output.push(`${indent}${chalk.gray(num + ".")} ${content}`);
      continue;
    }

    // Regular paragraph line
    output.push(renderInline(line));
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
 * Render inline markdown: bold, italic, code, links, strikethrough.
 */
function renderInline(text: string): string {
  let result = text;

  // Code spans — file paths get clickable links, rest get cyan styling
  result = result.replace(/`([^`]+)`/g, (_, code: string) => {
    if (looksLikeFilePath(code)) {
      return fileLink(chalk.cyan.underline(code), code);
    }
    return chalk.cyan(code);
  });

  // Bold + italic (***text*** or ___text___)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t));
  result = result.replace(/___(.+?)___/g, (_, t) => chalk.bold.italic(t));

  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  result = result.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));

  // Italic (*text* or _text_) — careful not to match mid-word underscores
  result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_, t) => chalk.italic(t));
  result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_, t) => chalk.italic(t));

  // Strikethrough (~~text~~)
  result = result.replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));

  // Links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    chalk.blue(label) + chalk.gray.dim(` (${url})`)
  );

  return result;
}
