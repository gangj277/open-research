/**
 * Lightweight LaTeX → HTML converter for live preview.
 * Handles document structure, basic formatting, math (via KaTeX), citations, and lists.
 * NOT a full LaTeX engine — this is for drafting preview, not publication.
 */

export function latexToHtml(latex: string): string {
  let body = latex;

  // Extract content between \begin{document} and \end{document}
  const docMatch = body.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (docMatch) body = docMatch[1];

  // Extract title, author, date from preamble
  const titleMatch = latex.match(/\\title\{([^}]*)\}/);
  const authorMatch = latex.match(/\\author\{([^}]*)\}/);
  const dateMatch = latex.match(/\\date\{([^}]*)\}/);
  const abstractMatch = body.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);

  // Remove \maketitle
  body = body.replace(/\\maketitle/, "");

  // Remove abstract from body (we'll render it separately)
  body = body.replace(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/, "");

  // ── Sections ──
  body = body.replace(/\\section\*?\{([^}]*)\}/g, '<h2 class="section">$1</h2>');
  body = body.replace(/\\subsection\*?\{([^}]*)\}/g, '<h3 class="subsection">$1</h3>');
  body = body.replace(/\\subsubsection\*?\{([^}]*)\}/g, '<h4 class="subsubsection">$1</h4>');
  body = body.replace(/\\paragraph\{([^}]*)\}/g, '<h5 class="paragraph">$1</h5>');

  // ── Formatting ──
  body = body.replace(/\\textbf\{([^}]*)\}/g, "<strong>$1</strong>");
  body = body.replace(/\\textit\{([^}]*)\}/g, "<em>$1</em>");
  body = body.replace(/\\texttt\{([^}]*)\}/g, "<code>$1</code>");
  body = body.replace(/\\emph\{([^}]*)\}/g, "<em>$1</em>");
  body = body.replace(/\\underline\{([^}]*)\}/g, "<u>$1</u>");

  // ── Citations ──
  body = body.replace(/\\cite\{([^}]*)\}/g, '<span class="citation">[$1]</span>');
  body = body.replace(/\\citep\{([^}]*)\}/g, '<span class="citation">($1)</span>');
  body = body.replace(/\\citet\{([^}]*)\}/g, '<span class="citation">$1</span>');
  body = body.replace(/\\ref\{([^}]*)\}/g, '<span class="ref">[ref:$1]</span>');
  body = body.replace(/\\label\{([^}]*)\}/g, "");

  // ── Math ──
  // Display math: \[ ... \] and $$ ... $$
  body = body.replace(/\\\[([\s\S]*?)\\\]/g, '<div class="math-display">\\[$1\\]</div>');
  body = body.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-display">\\[$1\\]</div>');
  // Equation environment
  body = body.replace(
    /\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g,
    '<div class="math-display">\\[$1\\]</div>'
  );
  body = body.replace(
    /\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g,
    '<div class="math-display">\\[$1\\]</div>'
  );
  // Inline math: $ ... $ (careful not to match $$)
  body = body.replace(/(?<!\$)\$(?!\$)([^$]+?)\$(?!\$)/g, '<span class="math-inline">\\($1\\)</span>');

  // ── Lists ──
  body = body.replace(/\\begin\{itemize\}/g, "<ul>");
  body = body.replace(/\\end\{itemize\}/g, "</ul>");
  body = body.replace(/\\begin\{enumerate\}/g, "<ol>");
  body = body.replace(/\\end\{enumerate\}/g, "</ol>");
  body = body.replace(/\\item\s*/g, "<li>");

  // ── Environments ──
  body = body.replace(
    /\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g,
    "<blockquote>$1</blockquote>"
  );
  body = body.replace(
    /\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g,
    "<pre><code>$1</code></pre>"
  );

  // ── Figures (placeholder) ──
  body = body.replace(
    /\\begin\{figure\}[\s\S]*?\\caption\{([^}]*)\}[\s\S]*?\\end\{figure\}/g,
    '<figure class="figure-placeholder"><figcaption>$1</figcaption></figure>'
  );

  // ── Tables (placeholder) ──
  body = body.replace(
    /\\begin\{table\}[\s\S]*?\\caption\{([^}]*)\}[\s\S]*?\\end\{table\}/g,
    '<figure class="table-placeholder"><figcaption>Table: $1</figcaption></figure>'
  );

  // ── Footnotes ──
  body = body.replace(/\\footnote\{([^}]*)\}/g, '<sup class="footnote" title="$1">[*]</sup>');

  // ── Clean up remaining commands ──
  body = body.replace(/\\bibliography\{[^}]*\}/g, "");
  body = body.replace(/\\bibliographystyle\{[^}]*\}/g, "");
  body = body.replace(/\\usepackage\{[^}]*\}/g, "");
  body = body.replace(/\\documentclass[^{]*\{[^}]*\}/g, "");
  body = body.replace(/\\begin\{document\}/g, "");
  body = body.replace(/\\end\{document\}/g, "");
  body = body.replace(/\\newcommand[^{]*\{[^}]*\}\{[^}]*\}/g, "");

  // ── Line breaks & paragraphs ──
  body = body.replace(/\\\\/g, "<br>");
  body = body.replace(/\\newline/g, "<br>");
  body = body.replace(/\\noindent\s*/g, "");
  body = body.replace(/\\vspace\{[^}]*\}/g, "");
  body = body.replace(/\\hspace\{[^}]*\}/g, "");

  // Convert double newlines to paragraph breaks
  body = body.replace(/\n\s*\n/g, "</p><p>");
  body = `<p>${body}</p>`;
  body = body.replace(/<p>\s*<\/p>/g, "");
  body = body.replace(/<p>\s*<(h[2-5])/g, "<$1");
  body = body.replace(/<\/(h[2-5])>\s*<\/p>/g, "</$1>");

  // ── Build full HTML ──
  const titleHtml = titleMatch ? `<h1 class="title">${titleMatch[1]}</h1>` : "";
  const authorHtml = authorMatch ? `<p class="author">${authorMatch[1]}</p>` : "";
  const dateHtml = dateMatch ? `<p class="date">${dateMatch[1]}</p>` : "";
  const abstractHtml = abstractMatch
    ? `<div class="abstract"><h3>Abstract</h3><p>${abstractMatch[1].trim()}</p></div>`
    : "";

  return `${titleHtml}${authorHtml}${dateHtml}${abstractHtml}${body}`;
}
