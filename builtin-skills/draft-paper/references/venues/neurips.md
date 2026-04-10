# NeurIPS Submission Guidelines

## LaTeX Template

Use the official NeurIPS style file. Replace the generic preamble with:

```latex
\documentclass{article}
\usepackage[preprint]{neurips_2025}
% For submission (anonymous + line numbers): \usepackage{neurips_2025}
% For camera-ready (accepted): \usepackage[final]{neurips_2025}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{cleveref}
\usepackage{microtype}
\usepackage{natbib}
```

Only add packages justified by actual content (e.g., \usepackage{algorithm2e} if you have pseudocode).

## Format Constraints

- **Layout**: Single column, US Letter (8.5" x 11")
- **Font**: Times New Roman, 10pt body, 11pt leading
- **Title**: 17pt bold, centered, framed by horizontal rules
- **Page limit**: 9 pages for main content (figures, tables included). References, checklist, and appendices do NOT count.
- **Camera-ready**: +1 page (10 pages main content)
- **Max PDF size**: 50 MB
- **Supplementary**: Single ZIP, max 100 MB
- **Fonts in PDF**: Must be Type 1 or embedded TrueType only — no bitmap/Type 3

## Required Sections

1. **Abstract** — One paragraph, no explicit word limit but must fit the indented abstract block (~200-250 words practical). Claims must match paper content.
2. **Introduction** — Problem, why it matters, what others missed, this paper's contribution, roadmap sentence
3. **Related Work** — Can combine with Introduction or Background
4. **Method / Approach**
5. **Experiments / Results** — With error bars, ablations, statistical significance
6. **Conclusion**
7. **References** — After main body, unlimited pages
8. **NeurIPS Paper Checklist** — 16 required items after references (mandatory, desk reject if missing)

### Strongly Recommended
- **Limitations** section — Reviewers actively look for this. A paper that acknowledges limits is rated higher.
- **Broader Impacts** — Expected when applicable (malicious uses, bias, privacy, environment)
- **Acknowledgments** — Use \begin{ack}...\end{ack} (auto-hidden in anonymous mode)

## Anonymization (Double-Blind)

- Remove ALL author names, affiliations, acknowledgments
- Self-cite in third person: "Jones et al. [4] showed..." NOT "We previously showed [4]"
- All supplementary materials (code, data, appendices) must be anonymized
- No identifiable GitHub links, institutional watermarks, or IRB institution names
- Violation = desk rejection without review
- Posting non-anonymous preprints on arXiv is allowed and does NOT cause rejection

## Review Criteria (Each Rated 1-4)

1. **Quality** — Claims well-supported by theory or experiments; methodology appropriate; work complete
2. **Clarity** — Well-organized, enough detail for expert to reproduce results
3. **Significance** — Impact on community; others likely to use or build on ideas
4. **Originality** — New insights or understanding; clear differentiation from prior work

### Overall Score (1-6)
- 6: Strong Accept — technically flawless, groundbreaking
- 5: Accept — solid, high impact on at least one sub-area
- 4: Borderline Accept
- 3: Borderline Reject
- 2: Reject — technical flaws, weak evaluation
- 1: Strong Reject

## Reproducibility Checklist (Key Items)

- All assumptions explicitly stated
- Full experimental details (hyperparameters, splits, optimizer settings)
- Error bars, confidence intervals, or significance tests for main claims
- Compute resources reported (GPU type, memory, runtime)
- Code and data accessible (anonymized links at submission)

## Common Rejection Reasons

**Desk rejection triggers:**
- Page limit exceeded (>9 pages main content)
- Modified style file parameters
- Missing paper checklist
- Anonymization violations
- Dual submission

**Scientific rejection:**
- Weak evaluation: insufficient baselines, missing ablations, no error bars
- Overclaiming: abstract/intro claims broader than experiments support
- Missing limitations: if reviewers find limitations you didn't acknowledge, it hurts more than disclosing them
- Inadequate related work or failure to differentiate from prior work
- Appendix-heavy papers hiding critical details to circumvent page limits

## Formatting Details

- **Headings**: 12pt bold flush left (1st level), 10pt bold (2nd), 10pt bold inline (3rd)
- **Math**: Use LaTeX display environments (equation, align), NOT $$ (breaks line numbering)
- **Tables**: Center; use booktabs (\toprule, \midrule, \bottomrule). No vertical rules. Caption BEFORE table.
- **Figures**: Caption AFTER figure. Captions lowercase except first word.
- **References**: natbib loaded by default. Both author/year and numeric styles acceptable.
- **Footnotes**: Superscript after punctuation. Minimize use.

## Key Policy Notes

- Authors bear full responsibility for AI-generated content including citations
- Rebuttal: 10,000 characters max, no paper revisions allowed
- Acceptance rate: ~24-25%
