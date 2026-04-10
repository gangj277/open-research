# CHI (ACM Conference on Human Factors in Computing Systems) Submission Guidelines

## LaTeX Template

Use the ACM sigconf template. Replace the generic preamble with:

```latex
\documentclass[manuscript,review,anonymous]{acmart}
% For camera-ready (accepted): \documentclass[sigconf]{acmart}

\usepackage{booktabs}
\usepackage{graphicx}
\usepackage{amsmath}

% ACM-specific metadata (fill in for camera-ready)
% \acmConference[CHI '26]{CHI Conference on Human Factors in Computing Systems}{April 2026}{Yokohama, Japan}
% \acmDOI{...}
% \acmISBN{...}

\bibliographystyle{ACM-Reference-Format}
```

For submission (review), use the `manuscript,review,anonymous` options which produce single-column, double-blind output.

## Format Constraints

- **Layout**: Single-column for review; final publication is 2-column (ACM handles conversion via TAPS)
- **Length**: Measured by word count (NOT pages), excluding references, captions, and appendices:
  - Short paper: ≤5,000 words
  - Standard paper: 5,001–12,000 words (typical: 7,000–8,000)
  - Over 12,000 words triggers desk rejection unless strongly justified
- **No fixed page limit** — length governed by word count
- **Template**: Must use official ACM template. Wrong template = desk rejection.
- **Bibliography style**: ACM-Reference-Format (numbered citations [1], [2])
- **Figures**: Vector formats preferred (PDF, EPS, SVG). Include \Description{} for alt text.

## Required Sections

CHI does not mandate rigid section names, but reviewers expect:

### Empirical/Study Papers
Abstract → Introduction → Related Work → Method/Participants → Analysis/Results → Discussion → Conclusion → References

### System/Design Papers
Abstract → Introduction → Related Work → Design Process → System Architecture → Evaluation → Discussion → Conclusion → References

### What Each Section Must Accomplish
- **Introduction**: Establish the HCI problem, motivate why it matters, state contribution EXPLICITLY. Don't make reviewers guess.
- **Related Work**: Must be comprehensive enough to contextualize in HCI scholarship. Grossly insufficient lit review = Assisted Desk Rejection (ADR-Context).
- **Method**: Sufficient detail for replication. Explain WHY, not just WHAT. Missing this = ADR-Method.
- **Results/Findings**: Adequate data to support claims. Insufficient data = ADR-Data.
- **Discussion**: Critically engage with results, limitations, generalizability, ethics. Shallow discussions are flagged.

## Anonymization (Double-Blind)

- Remove author names, affiliations, acknowledgments, document metadata
- DO NOT anonymize references — cite your prior work normally
- DO write about your own work in third person: "Smith et al. [10] showed..." NOT "Our previous work [10]..."
- Marking any reference as "[Anonymous]" = desk rejection
- All supplementary materials must be anonymized
- Preprints (arXiv) allowed but CHI notes they can create unconscious reviewer bias

## Abstract

- **Maximum**: 150 words
- Must not be a placeholder — incomplete metadata triggers desk rejection

## Accessibility Requirements (Important for CHI)

- **Alt text**: Provide meaningful \Description{} for every figure
- **Color**: Don't convey info through color alone — add patterns, shapes, line styles
- **Tables**: Use actual table markup, not images
- **Equations**: Use LaTeX math, not images
- **Video figures**: Must include closed captions (.srt or .sbv)
- Inaccessible papers may be reassigned to non-optimal reviewers

## Review Criteria

### Five Core Dimensions
1. **Significance** — Why does this contribution matter to HCI?
2. **Originality** — What new ideas, methods, systems, or knowledge?
3. **Research Quality** — How rigorous, transparent, well-executed?
4. **Presentation Clarity** — Concise, well-organized, jargon-free?
5. **Prior Work Engagement** — Adequately reviewed and critically engaged?

### Length-to-Contribution Proportionality
Reviewers assess whether paper length is commensurate with contribution. Long papers must justify their length through substantive contribution.

### Assisted Desk Rejection (ADR) Criteria (New for CHI 2026)
1. **ADR-Context**: Severely inadequate literature review
2. **ADR-Method**: Insufficient methodological transparency
3. **ADR-Data**: Grossly inadequate data for claims
4. **ADR-Contribution**: Disproportionately small HCI contribution for length

### Review Process
CHI uses a Revise & Resubmit model:
- Round 1: Threshold decisions. Papers with ≥1 "Revise & Resubmit or higher" advance.
- Round 2: Final "Accept with minor revisions" or "Reject." No further revision.

## Common Rejection Reasons

**Desk rejection triggers:**
- Wrong template or format
- Any anonymization violation (paper, supplements, external links)
- Marking any reference as "anonymous"
- Over 12,000 words without justification
- Missing or placeholder abstract/metadata
- Unmarked LLM-generated content

**Substantive rejection:**
- Paper length incommensurate with contribution
- Insufficient research quality or rigor
- Inadequate theoretical grounding
- Unclear or unjustified design choices
- Not explaining the "why" behind methodological choices
- Shallow discussion of ethics, limitations, generalizability

## Camera-Ready Specifics

- Switch to \documentclass[sigconf]{acmart}
- Add CCS concepts (generate at dl.acm.org/ccs/ccs.cfm)
- Add keywords (4-8 terms)
- Include acknowledgments and author info
- Retain ACM copyright/DOI block without alteration

## Key Policy Notes

- Papers reviewed "mostly on an as-is basis" — submit in near-publishable form
- Make contribution explicit and early
- LLM use for beyond editing must be disclosed; unmarked = desk rejection
- Acceptance rate: ~25%
