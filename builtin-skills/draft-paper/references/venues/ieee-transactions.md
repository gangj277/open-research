# IEEE Transactions Submission Guidelines

## LaTeX Template

Use the IEEEtran document class. Replace the generic preamble with:

```latex
\documentclass[journal]{IEEEtran}
% For Computer Society journals (TPAMI, TSE): \documentclass[10pt,journal,compsoc]{IEEEtran}
% For Communications Society: \documentclass[journal,comsoc]{IEEEtran}
% For technical notes/letters (9pt): \documentclass[9pt,technote]{IEEEtran}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{cite}
\usepackage{hyperref}
\usepackage{microtype}

% Restore page breaks within equations when using amsmath
\interdisplaylinepenalty=2500
```

Template files: template-selector.ieee.org or Overleaf (preloaded). Do NOT modify IEEEtran.cls.

## Format Constraints

- **Paper size**: US Letter (8.5" x 11")
- **Layout**: Two-column, single-spaced
- **Font**: Times New Roman, 10pt body
- **Column width**: 3.5 inches (88.9 mm) single column; 7.16 inches (182 mm) full page span

### Page Limits (Vary by Journal)
| Journal | Regular Paper | Short/Brief |
|---------|--------------|-------------|
| TPAMI (Computer Society) | 14 pages | 8 pages |
| TNNLS (Comp. Intelligence) | ~14 pages | 3 pages |
| Signal Processing Society | 13 initial / 16 revised | 2 pages |
| T-ASE (Robotics & Automation) | 12 pages | 6 pages |
| Trans. Automatic Control | 12 pages (13-16 mandatory charge) | — |

All limits include references and author biographies. Check specific journal for exact limits.

## Required Sections (Standard Structure)

1. **Title** — Title case, concise, reflective of content
2. **Author names and affiliations** (omitted in double-blind review)
3. **Abstract** — 150-250 words, single paragraph
4. **Index Terms** — After abstract, from IEEE Thesaurus
5. **I. Introduction** — Use \IEEEPARstart for decorative drop cap
6. **Body sections** — Roman numeral headings (II, III, IV, ...)
7. **Conclusion** — Singular; do not replicate abstract
8. **Acknowledgment** — Singular (not "Acknowledgements"); before References
9. **References** — Numbered list in order of appearance
10. **Author Biographies** — With head-and-shoulders photograph; after References

### Section Heading Hierarchy
- **Primary**: Roman numeral, centered, 10pt bold small caps — "II. RELATED WORK"
- **Secondary**: Letter label, flush left, italic — "A. Feature Extraction"
- **Tertiary**: Arabic numeral with close paren, italic, indented — "1) Convolutional Layers:"

## Abstract Requirements

- **150-250 words**, single paragraph ONLY
- NO abbreviations (except IEEE, SI, ac, dc), footnotes, references, display equations, or tables
- Self-contained: problem statement, methodology, key results, main conclusions
- Set in 9pt in published layout (handled by IEEEtran)

## Index Terms / Keywords

- Placed immediately after abstract
- 4-6 terms from the **IEEE Thesaurus** (~12,420 controlled vocabulary terms)
- Format: "Index Terms—" followed by comma-separated terms in alphabetical order
- Used for IEEE Xplore discoverability

## Math and Equations

- Number all displayed equations consecutively: (1), (2), (3)... flush right
- Appendix equations: (A1), (A2)
- Refer to equations as "(1)" in text — NOT "Eq. (1)" except at sentence start
- **Scalars**: italic (*x*). **Vectors**: bold (**x**). **Matrices**: bold uppercase (**A**).
- Functions: roman (sin, exp, log, max). Units: roman (Hz, km).
- All symbols defined on first use
- Use \begin{equation}, \begin{align} — NEVER use eqnarray or $$

## Figure Requirements

- **Resolution**: Min 300 DPI photos/grayscale; min 600 DPI line art
- **Formats**: PS, EPS, TIFF, PDF, PNG
- **Single column**: 3.5" wide. **Double column**: 7.16" wide.
- **Fonts**: Embed all fonts. Use Times New Roman, Helvetica, Arial. 8-10pt labels.
- **Captions**: BELOW figure. Format: "Fig. 1. Title" with sentence case.
- **Subfigures**: (a), (b), (c) in 8pt Times, centered below each.
- **Color**: Verify readability in grayscale — many journals print B&W.

## Table Requirements

- **Numbering**: Roman numerals — TABLE I, TABLE II
- **Caption**: ABOVE table (opposite of figures). Full caps header.
- **Formatting**: Vertical lines optional. Use booktabs for clean formatting.
- **Footnotes**: Letter superscripts (a, b, c), not numbers

## Reference Format (IEEE Style)

Numbered citations in square brackets: [1], [2], [3]. Order by first appearance.

Templates:
```
[1] A. B. Author, "Article title," Abbrev. Journal, vol. X, no. Y, pp. 123-456, Mon. Year.
[2] J. K. Author, "Paper title," in Proc. Abbrev. Conf., Location, Mon. Year, pp. 123-456.
[3] A. B. Author, Book Title, Xth ed. City, State: Publisher, Year.
```

- Author format: First initial(s) + family name (J. K. Smith)
- Journal titles: italic, standard IEEE abbreviations
- Use standard month abbreviations: Jan., Feb., Mar., etc.

## Review Criteria

### Core Requirements
1. **Novelty**: New or innovative methods/approaches
2. **Appropriateness**: Within journal scope, well-written, complete
3. **Quality**: Technical accuracy and rigor
4. **Impact**: Significant contribution to field and readership

### Review Decisions
- **A (Accepted)**: Only minor fixes (typos)
- **AQ (Accepted with Mandatory Revisions)**: Minor fixes verifiable by AE
- **RQ (Major Revision)**: Serious flaws requiring second review
- **R (Rejected)**: Fails novelty/appropriateness

### Review Process
- Minimum 2 independent reviewers
- Most journals: single-blind (reviewers anonymous, authors visible)
- Some journals double-blind: TNNLS, T-ASE, IEEE Communications Letters
- Plagiarism screening automated before and during review

### Conference Paper Extensions
- Must cite prior conference publication
- ≥60-70% new material required (max 30-40% text overlap)
- Novel additions: expanded theory, more extensive experiments, new analysis

## Common Rejection Reasons

**Desk rejection:**
- Out of scope
- Plagiarism >30-40% similarity
- Dual submission
- Wrong format (not IEEE two-column)
- Page limit exceeded

**After review:**
- Insufficient novelty (incremental variation of prior work)
- Weak experimental validation (missing ablations, weak baselines)
- Poor presentation quality
- Inadequate literature review (<10-15 peer-reviewed citations)
- Overreliance on conference papers/websites instead of journal references
- Figures unreadable in grayscale

## Overlength Page Charges

- **Voluntary**: $110/page within standard limit (optional)
- **Mandatory overlength**: $220-250/page exceeding journal limit (non-negotiable)
- Open access APC (~$2,800) is separate from overlength charges
- IEEE member discount: 5-20% on APC

## Key Policy Notes

- Initial submission can be single-column for readability (check journal preference)
- Camera-ready must be in IEEE two-column format
- Author biographies with photo required for final version (some journals no longer require photo)
