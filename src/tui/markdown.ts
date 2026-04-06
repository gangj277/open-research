import chalk from "chalk";

// ── Render Options ──────────────────────────────────────────────────────────

export interface RenderMarkdownOptions {
  baseDir?: string;
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
      const content = renderInline(headingMatch[2]);
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
      const content = renderInline(line.replace(/^\s*>\s?/, ""));
      output.push(chalk.gray("│ ") + chalk.italic(content));
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.+)$/);
    if (ulMatch) {
      output.push(`${ulMatch[1]}${chalk.gray("•")} ${renderInline(ulMatch[2])}`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      output.push(`${olMatch[1]}${chalk.gray(olMatch[2] + ".")} ${renderInline(olMatch[3])}`);
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
 * File paths in backticks get underlined cyan styling for visual distinction.
 */
function renderInline(text: string): string {
  let result = text;

  // Code spans — styled cyan, file paths get underline
  result = result.replace(/`([^`]+)`/g, (_, code: string) => chalk.cyan(code));

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

  return result;
}
