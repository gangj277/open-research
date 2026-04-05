import { describe, expect, test } from "vitest";
import { renderMarkdown } from "@/tui/markdown";
import chalk from "chalk";

describe("markdown renderer", () => {
  test("returns plain text unchanged when no markdown syntax", () => {
    expect(renderMarkdown("Hello world")).toBe("Hello world");
  });

  test("renders bold text", () => {
    const result = renderMarkdown("This is **bold** text");
    expect(result).toContain(chalk.bold("bold"));
    expect(result).not.toContain("**");
  });

  test("renders italic text", () => {
    const result = renderMarkdown("This is *italic* text");
    expect(result).toContain(chalk.italic("italic"));
  });

  test("renders code spans", () => {
    const result = renderMarkdown("Use `console.log` to debug");
    expect(result).toContain(chalk.cyan("console.log"));
    expect(result).not.toContain("`");
  });

  test("renders code blocks with borders", () => {
    const result = renderMarkdown("```python\nprint('hello')\n```");
    expect(result).toContain("print('hello')");
    expect(result).toContain("│");
    expect(result).toContain("python");
  });

  test("renders headings with color", () => {
    const result = renderMarkdown("# Title\n## Subtitle");
    expect(result).toContain(chalk.bold.cyan("Title"));
    expect(result).toContain(chalk.bold.white("Subtitle"));
  });

  test("renders unordered lists with bullets", () => {
    const result = renderMarkdown("- item one\n- item two");
    expect(result).toContain("•");
    expect(result).toContain("item one");
    expect(result).toContain("item two");
  });

  test("renders ordered lists", () => {
    const result = renderMarkdown("1. first\n2. second");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  test("renders blockquotes", () => {
    const result = renderMarkdown("> This is a quote");
    expect(result).toContain("This is a quote");
    expect(result).toContain("│");
  });

  test("renders links", () => {
    const result = renderMarkdown("[click here](https://example.com)");
    expect(result).toContain(chalk.blue("click here"));
    expect(result).toContain("example.com");
  });

  test("renders horizontal rules", () => {
    const result = renderMarkdown("---");
    expect(result).toContain("─");
  });

  test("handles empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("  ")).toBe("  ");
  });

  test("renders strikethrough", () => {
    const result = renderMarkdown("This is ~~wrong~~ correct");
    expect(result).toContain(chalk.strikethrough("wrong"));
  });
});
