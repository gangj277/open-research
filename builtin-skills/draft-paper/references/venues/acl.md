# ACL (Association for Computational Linguistics) Submission Guidelines

## LaTeX Template

Use the official ACL style files. Replace the generic preamble with:

```latex
\documentclass[11pt]{article}
\usepackage[hyperref]{acl}
% For camera-ready: \usepackage[hyperref,accepted]{acl}

\usepackage{times}
\usepackage{latexsym}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{microtype}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{booktabs}
```

Style files: github.com/acl-org/acl-style-files. Do NOT modify the style file.

## Format Constraints

- **Paper size**: A4 (NOT US Letter — unlike NeurIPS/IEEE)
- **Layout**: Two-column, single-spaced
- **Font**: Times Roman, 11pt body text
- **Column width**: 7.7 cm, gap 0.6 cm
- **Margins**: 2.5 cm on all sides
- **Line numbers**: Required in review version (ruler in left/right margins)
- **All fonts embedded** in PDF — verify with `pdffonts mypaper.pdf`

### Page Limits
| Type | Submission | Camera-Ready |
|------|-----------|-------------|
| Long paper | 8 pages | 9 pages |
| Short paper | 4 pages | 5 pages |

References, Limitations, Ethics section, and appendices are UNLIMITED and do NOT count toward page limits.

## Required Sections (Mandatory)

### 1. Abstract
- **Max 200 words**, 10pt, centered, indented 0.6cm each side
- Also entered separately in OpenReview submission form

### 2. Main Body (within page limit)
Introduction → [Literature Review] → Method → Results → Conclusion

### 3. Limitations Section (MANDATORY — desk reject if missing)
- Title must be exactly "Limitations"
- Placed after Conclusion, before References, NO page break between them
- Does NOT count toward page limit
- Content: assumptions, scope (datasets, languages, domains), computational constraints, generalizability, bias definitions
- Discussion only — do NOT introduce new experiments or results here

### 4. References
- Alphabetically arranged, unnumbered heading
- Unlimited, outside page limit

### Optional But Strongly Encouraged
- **Ethical Considerations / Broader Impact** — after Conclusion alongside Limitations, before References. Functionally required for papers with sensitive data or potentially harmful applications. Papers that should address ethics but don't will not be accepted.
- **Appendices** — after References, labeled A, B, C. MUST use double-column format (desk rejection since July 2025 if not). Single-column permitted only for math-heavy sections.

## Anonymization

- Remove author names and affiliations from paper
- Write about your own work in third person
- Exclude Acknowledgments entirely from review version
- Anonymize supplementary materials and code links (use anonymous.4open.science)
- No anonymity period restriction — preprints allowed at any time before/during/after review

## Review Criteria (ARR Three-Score System)

### Soundness (1-5, half-point)
Technical correctness, thoroughness, adequate support for claims.
- 5: One of the most thorough studies of its type
- 3: Sufficient support for main claims
- 1: Major correctness or rigor problems

### Excitement (1-5, half-point)
Subjective interest and potential impact. Orthogonal to soundness.
- 5: Would strongly recommend to others
- 3: Worth publishing at the venue
- 1: Would not prioritize

### Overall Assessment (1-5, half-point)
Composite recommendation:
- 5: Consider for Award
- 4: Conference (main track acceptance)
- 3: Findings (ACL Findings acceptance)
- 2: Resubmit
- 1: Do not resubmit

### Problem Codes Reviewers Flag
**Methodology**: LLM-only evaluation without reliability validation (M1), insufficient reproducibility (M2), unmotivated model selection (M4)
**Results**: Statistical errors/p-hacking (R1), overclaiming beyond evaluated scope (R2, R4), speculation as fact (R3)
**General**: Unclear research question (G1), misrepresented related work (G3), misleading citations (G5)

## Responsible NLP Checklist (Mandatory)

Completed in OpenReview submission form. Incorrect/incomplete/misleading answers = desk rejection (enforced since Dec 2024). Published as appendix for accepted papers.

Key sections:
- **A**: Limitations discussion, potential risks
- **B**: Existing artifacts (citations, licenses, intended use, personal data screening)
- **C**: Computational experiments (budget, setup, error bars, packages)
- **D**: Human annotators (instructions, payment ≥ minimum wage, consent, IRB)
- **E**: AI assistant disclosure (ChatGPT, Copilot usage)

## Common Rejection Reasons

**Automatic desk rejection:**
- Missing Limitations section
- Page limit exceeded or wrong paper size (must be A4)
- Wrong template or modified style files
- Anonymization breach
- Checklist violations
- Non-double-column appendices (since July 2025)

**Substantive rejection:**
- Claims not supported by evidence
- LLM-only evaluation without validation
- Overclaiming from benchmark results
- Missing significance tests or effect sizes
- Key related work missing or misrepresented
- Insufficient reproducibility details

## ACL Rolling Review (ARR) Process

- Centralized review via OpenReview; monthly submission cycles
- Papers receive reviews once, then authors "commit" reviews to a venue (ACL, EMNLP, NAACL, etc.)
- Minimum 3 independent reviewers per paper
- After reviews: author response → reviewer discussion → meta-review
- Revised resubmissions must include revision notes and link to prior version

## Key Formatting Details

- **Title**: 15pt bold, centered
- **Section headings**: 12pt bold
- **Subsection**: 11pt bold
- **Captions**: 10pt
- **Footnotes**: 9pt
- **References**: 10pt
- **Acknowledgments**: Excluded from review version, included in camera-ready only
