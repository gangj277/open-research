# Nature Journal Submission Guidelines

## LaTeX Template

Nature accepts LaTeX submissions. Use a clean article class — Nature does NOT have a public .sty file like conferences. The editorial team reformats accepted manuscripts.

```latex
\documentclass[12pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{natbib}
\usepackage{microtype}

\linespread{2.0}  % Double-spacing required for review
```

Nature uses a numbered (Vancouver) reference style with superscript citations. After acceptance, the production team applies Nature's house style.

## Article Types and Length

**"Letters" were retired in October 2019.** All original research is now "Article."

### Article (Primary Research)
- **Physical sciences**: ~2,500 words main text + 4 display items (~6 printed pages)
- **Biological/clinical/social sciences**: ~4,300 words main text + 5-6 display items (~8 printed pages)
- **Display items**: Max 8 total (figures + tables combined)
- **Methods**: Separate section, up to ~3,000 words
- **References**: ~50 in main text (methods-only references exempt from this count)

### Other Types (less common for researchers)
- Review Article: ~5,000 words, ~150 refs (usually commissioned)
- Correspondence: 300-800 words, ~10 refs
- Matters Arising: <1,200 words

## Document Structure (Canonical Order)

1. **Title** — ~75 characters max, clear to broad readership, no abbreviations
2. **Authors and affiliations**
3. **Bold summary paragraph** (the "abstract") — ~200 words, fully referenced, unstructured
4. **Main text** — NO headed "Introduction" section; weave intro into narrative flow
5. **Main references** — numbered consecutively by order of appearance
6. **Tables**
7. **Figure legends** — listed sequentially after references
8. **Methods section** — placed AFTER references (not inline), includes:
   - Data availability statement (mandatory)
   - Code availability statement (mandatory if custom code used)
9. **Methods references** — continuing numbering from main references
10. **Acknowledgements**
11. **Funding statement**
12. **Author contributions** (CRediT format)
13. **Competing interests declaration** (mandatory even if none)
14. **Extended Data figure/table legends**

## Abstract ("Summary Paragraph")

- ~200 words or fewer
- Written in **bold**
- Fully referenced (references appear in main reference list)
- Unstructured — NO subheadings
- Must be accessible to readers outside the immediate subfield
- Avoid numbers, abbreviations, acronyms unless essential
- Functions as both a non-technical intro AND brief summary of results + implications

## Methods Section

- Placed AFTER main references and figure legends (not inline with main text)
- Up to ~3,000 words
- Subdivided by short bold headings for specific methods
- Specific subsections encouraged for: Statistics, Reagents, Animal models
- Methods-only references do NOT count against the ~50 reference limit
- Must contain:
  - **Data availability** statement
  - **Code availability** statement
  - For animal studies: named institutional committee, confirmation of guideline compliance
  - For human subjects: named ethics committee, informed consent confirmation

## Reference Format (Vancouver/Numbered)

In-text: superscript numbers (e.g., `\textsuperscript{1,2}` or `\textsuperscript{1-4}`)

Reference list format:
```
Author(s). Article title. Journal Title vol, pages (year).
```
- Author: surname first, then initials
- 6+ authors: first author et al.
- Journal title: italic, abbreviated
- Volume: bold
- Article titles ARE required

Use \begin{thebibliography}{99} with \bibitem, NOT BibTeX (to maintain precise control over formatting).

## Figures

- **Widths**: Single column 89mm, 1.5 column 120-136mm, full page 183mm
- **Resolution**: Min 300 DPI (450 DPI recommended)
- **Font in figures**: Arial or Helvetica ONLY, 5-7pt minimum
- **Panel labels**: lowercase (a, b, c...), 8pt bold
- **Color**: RGB, colorblind-friendly palette (avoid red-green)
- **Scale bars**: Required for microscopy
- **Format**: PDF, EPS, AI, SVG preferred (vector-based)

## Extended Data vs Supplementary Information

- **Extended Data**: Up to 10 multi-panel items. Peer-reviewed, copy-edited, indexed as part of paper. Online only. Additional figures go HERE, not in SI.
- **Supplementary Information**: Large datasets, detailed methods too lengthy for Methods. Max 30MB/file, 150MB total. NOT for additional figures.

## Author Contributions (CRediT)

Required for ALL articles. Use CRediT taxonomy (14 roles):
Conceptualization, Data curation, Formal analysis, Funding acquisition, Investigation, Methodology, Project administration, Resources, Software, Supervision, Validation, Visualization, Writing - original draft, Writing - review & editing

Format: "J.S.: Conceptualization (lead), Writing - original draft (lead). K.M.: Methodology (lead), Software (lead)."

## Review Process

- **Editorial triage**: ~70% desk-rejected (some sources say >90%). Decision in 3-14 days.
- **Bar**: "Science that changes how the field thinks" — technically flawless alone is insufficient
- **Peer review**: 2-3 external reviewers, 4-8 weeks after assignment
- **Post-review acceptance**: ~40% of papers reaching peer review
- **Revision periods**: 6-12 months common when new experiments needed
- **Overall acceptance rate**: <8%

### What triggers editorial interest:
- Findings that overturn assumptions (not incremental improvements)
- Broad interdisciplinary appeal
- Narrative accessible to non-specialists from paragraph one
- Resolution of long-standing major problems

## Common Rejection Reasons

**At desk (editorial triage):**
- Incremental advance without conceptual breakthrough (most common)
- Better fit in specialist journal
- Written for specialists, not broad readership
- Leading with methods instead of findings
- Incomplete work submitted prematurely

**At/after peer review:**
- Insufficient statistical rigor (sample size, controls, blinding)
- Conclusions not fully supported by data
- Ethical compliance issues
- Inability to release code or data
- Poor figure quality or unclear data presentation

## Cover Letter

Must include:
- Statement that manuscript is original and not under review elsewhere
- Why findings interest Nature's broad readership
- The specific assumption the work overturns
- 4-5 suggested reviewers with affiliations

**Optimal opening**: "We show that X works via Y, overturning the assumption that Z" — not background.

## Presubmission Inquiry (Strongly Recommended)

- 1-page pitch: scientific question, why unresolved, key finding, 1-2 figures
- Response in ~2 working days
- ~25% encouraged to submit full paper
- Positive response ≠ guaranteed peer review
