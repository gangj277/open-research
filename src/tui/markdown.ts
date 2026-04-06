import chalk from "chalk";
import wrapAnsi from "wrap-ansi";
import { getTerminalWidth } from "@/tui/layout";

// ── Render Options ──────────────────────────────────────────────────────────

export interface RenderMarkdownOptions {
  baseDir?: string;
  theme?: "dark" | "light";
  terminalWidth?: number;
}

// ── Markdown Renderer ───────────────────────────────────────────────────────

/**
 * Lightweight terminal markdown renderer.
 * Handles: bold, italic, code spans, code blocks, headings, lists, blockquotes, links, horizontal rules.
 */
export function renderMarkdown(text: string, options: RenderMarkdownOptions = {}): string {
  if (!text || !text.trim()) return text;

  // Quick check: if no markdown syntax, return as-is
  if (!/[*_`#\[\]>~\-]/.test(text) && !text.includes("```")) return text;

  const isLight = options.theme === "light";
  const terminalWidth = Math.max(8, getTerminalWidth(options.terminalWidth));
  const prefixedLineWidth = Math.max(1, terminalWidth - 2);
  // Theme-aware color helpers
  const dim = isLight ? chalk.hex("#666666") : chalk.gray;
  const border = isLight ? chalk.hex("#999999") : chalk.gray;
  const codeText = isLight ? chalk.hex("#1a1a1a") : chalk.white;
  const h1 = isLight ? chalk.bold.blue : chalk.bold.cyan;
  const h2 = isLight ? chalk.bold.hex("#1a1a1a") : chalk.bold.white;
  const codeSpan = isLight ? chalk.blue : chalk.cyan;
  const linkLabel = isLight ? chalk.blue : chalk.blue;
  const linkUrl = isLight ? chalk.hex("#666666") : chalk.gray.dim;

  const lines = text.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  const pushWrappedPrefixedLines = (prefix: string, body: string, formatter: (value: string) => string) => {
    const wrapped = wrapAnsi(body, prefixedLineWidth, { trim: false, hard: true }).split("\n");
    for (const part of wrapped) {
      output.push(border(prefix) + formatter(part));
    }
  };

  const pushCodeBlock = () => {
    const labelText = codeBlockLang ? ` ${codeBlockLang} ` : "";
    const topWidth = Math.max(1, terminalWidth - 1 - labelText.length);
    output.push(border("┌" + "─".repeat(topWidth)) + dim(labelText));
    for (const cl of codeBlockLines) {
      pushWrappedPrefixedLines("│ ", cl, codeText);
    }
    output.push(border("└" + "─".repeat(Math.max(1, terminalWidth - 1))));
  };

  for (const line of lines) {
    // Code block toggle
    if (line.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        pushCodeBlock();
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
      const content = renderInline(headingMatch[2], codeSpan, linkLabel, linkUrl);
      if (level === 1) output.push(h1(content));
      else if (level === 2) output.push(h2(content));
      else output.push(chalk.bold(content));
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      output.push(border("─".repeat(terminalWidth)));
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith("> ")) {
      const content = renderInline(line.replace(/^\s*>\s?/, ""), codeSpan, linkLabel, linkUrl);
      pushWrappedPrefixedLines("│ ", content, chalk.italic);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.+)$/);
    if (ulMatch) {
      output.push(`${ulMatch[1]}${dim("•")} ${renderInline(ulMatch[2], codeSpan, linkLabel, linkUrl)}`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      output.push(`${olMatch[1]}${dim(olMatch[2] + ".")} ${renderInline(olMatch[3], codeSpan, linkLabel, linkUrl)}`);
      continue;
    }

    // Regular paragraph line
    output.push(renderInline(line, codeSpan, linkLabel, linkUrl));
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    pushCodeBlock();
  }

  return output.join("\n");
}

/**
 * Render inline markdown: bold, italic, code, links, strikethrough.
 * File paths in backticks get underlined cyan styling for visual distinction.
 */
function renderInline(
  text: string,
  codeColor: chalk.Chalk = chalk.cyan,
  linkColor: chalk.Chalk = chalk.blue,
  linkUrlColor: chalk.Chalk = chalk.gray.dim
): string {
  let result = text;

  // Code spans
  result = result.replace(/`([^`]+)`/g, (_, code: string) => codeColor(code));

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
    linkColor(label) + linkUrlColor(` (${url})`)
  );

  return result;
}
