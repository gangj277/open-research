import { describe, expect, test } from "vitest";
import { latexToHtml } from "@/lib/preview/latex-to-html";

describe("latexToHtml", () => {
  test("extracts title and author", () => {
    const latex = `\\documentclass{article}
\\title{My Paper}
\\author{John Doe}
\\begin{document}
\\maketitle
Hello world.
\\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('<h1 class="title">My Paper</h1>');
    expect(html).toContain("John Doe");
  });

  test("converts sections and subsections", () => {
    const html = latexToHtml(`\\begin{document}
\\section{Introduction}
Some text.
\\subsection{Background}
More text.
\\end{document}`);
    expect(html).toContain('<h2 class="section">Introduction</h2>');
    expect(html).toContain('<h3 class="subsection">Background</h3>');
  });

  test("converts bold and italic", () => {
    const html = latexToHtml(`\\begin{document}
\\textbf{bold} and \\textit{italic} and \\emph{emphasis}
\\end{document}`);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<em>emphasis</em>");
  });

  test("converts citations", () => {
    const html = latexToHtml(`\\begin{document}
As shown by \\cite{smith2023} and \\citep{doe2024}.
\\end{document}`);
    expect(html).toContain('<span class="citation">[smith2023]</span>');
    expect(html).toContain('<span class="citation">(doe2024)</span>');
  });

  test("converts inline and display math", () => {
    const html = latexToHtml(`\\begin{document}
Inline $E = mc^2$ and display:
\\[F = ma\\]
\\end{document}`);
    expect(html).toContain("\\(E = mc^2\\)");
    expect(html).toContain("\\[F = ma\\]");
  });

  test("converts lists", () => {
    const html = latexToHtml(`\\begin{document}
\\begin{itemize}
\\item First
\\item Second
\\end{itemize}
\\end{document}`);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>First");
    expect(html).toContain("<li>Second");
  });

  test("extracts abstract", () => {
    const html = latexToHtml(`\\begin{document}
\\begin{abstract}
This paper presents our findings.
\\end{abstract}
\\end{document}`);
    expect(html).toContain("Abstract");
    expect(html).toContain("This paper presents our findings.");
  });

  test("handles equation environment", () => {
    const html = latexToHtml(`\\begin{document}
\\begin{equation}
y = mx + b
\\end{equation}
\\end{document}`);
    expect(html).toContain("y = mx + b");
    expect(html).toContain("math-display");
  });
});
