# Position / Opinion Paper Structure

## Overview

A position paper presents and defends a specific stance on a debatable issue. It does NOT report original empirical data. Instead, it synthesizes existing evidence, applies expert reasoning, and argues for a particular conclusion, recommendation, or interpretation.

**Essential requirement**: There must be a legitimate opposing position. If there is no defensible other side, the paper is not a position paper — it is a factual report.

## When to Use This Structure

✅ A genuine debate exists and a position needs defending
✅ Policy or practice implications require expert argument
✅ A field needs direction-setting synthesis from senior researchers
✅ A new theoretical framework needs advocacy before empirical testing
✅ Response to another published paper is warranted

❌ When empirical data is available and should be collected → do the study
❌ When there is no legitimately defensible other side → not a debate
❌ When a systematic review would better synthesize the evidence
❌ In journals that exclusively publish empirical primary research

## How Position Papers Differ from Empirical Papers

| Dimension | Empirical (IMRAD) | Position Paper |
|-----------|-------------------|----------------|
| Primary goal | Report new data | Argue a position using existing evidence |
| Structure | IMRAD (rigid) | Intro-argument-counterargument-conclusion (flexible) |
| Evidence | Original collected data | Synthesized published literature |
| New data | Required | Not included |
| Voice | Typically passive | Active, first person acceptable |
| Length | 3,000-8,000 words | 1,500-4,000 words |

## Section Structure

### 1. TITLE
Should signal opinion/perspective nature. Some journals require article type labeling.

### 2. ABSTRACT (~150 words, if required)
States the issue, the position taken, primary supporting arguments, and conclusion. Not all venues require abstracts for opinion pieces.

### 3. INTRODUCTION
- Engage reader immediately with a compelling hook or problem statement
- Provide necessary background context
- Define key terms and scope of argument
- **State the thesis clearly** — the exact position the paper defends — near the end of the introduction
- Preview argument structure (in longer papers)

**The thesis must be specific, debatable, and actionable.**
- ❌ "AI has implications for medicine"
- ✅ "AI diagnostic tools should not replace physician judgment in primary care without mandatory human review requirements"

### 4. BACKGROUND / LITERATURE CONTEXT (Optional but Strengthening)
Brief review of the existing debate. Identifies key positions in the literature and where the author's position fits within or against them. Demonstrates the author knows the existing debate.

### 5. SUPPORTING ARGUMENTS (Multiple Sections)
Each argument gets its own section or substantial paragraph:

1. State the claim clearly
2. Provide supporting evidence (citations, data, expert testimony, logic)
3. Explain how this evidence supports the thesis
4. Transition to the next argument

**Acceptable evidence:**
- Published empirical studies, systematic reviews, meta-analyses
- Statistical data from credible sources
- Theoretical frameworks, expert consensus statements
- Logical deduction from established principles

**NOT acceptable:**
- Unpublished original data (unless venue explicitly permits)
- Personal anecdotes as primary evidence
- Unverified claims or non-credible sources

### 6. COUNTERARGUMENT SECTION (Required for Rigorous Academic Papers)
This distinguishes a sophisticated position paper from advocacy.

**Required approach:**
1. Identify the STRONGEST opposing argument(s) — not the weakest
2. Present counterargument fairly and accurately (steelmanning)
3. Refute using fact-based reasoning
4. Demonstrate why the original position still holds even granting the counterargument some validity

**What to avoid:**
- Personal attacks on opposing scholars
- Dismissive treatment of opposing views
- Selecting only the weakest version of opposing arguments (straw-manning)

**Placement**: Near end of argument sequence before Conclusion, OR woven throughout (each argument followed by its counterargument).

### 7. CONCLUSION
- Restate thesis (synthesized, not word-for-word)
- Summarize key arguments briefly
- State real-world implications of accepting the position
- Identify remaining questions or future research areas
- End with a strong, forward-looking statement
- Do NOT introduce new arguments

## Handling Evidence vs Opinion (Critical)

Every claim must be clearly signaled as one of:

| Type | Language | Citation? |
|------|----------|-----------|
| Established fact | "Studies demonstrate..." "Evidence shows..." | Required |
| Author's interpretation | "These findings suggest that..." "This indicates..." | Cite underlying evidence |
| Author's position | "We argue..." "We contend..." "We propose..." | Cite supporting evidence |
| Speculation | "May..." "Might..." "Could..." "Future research may reveal..." | Optional |

**Rules:**
- Every factual claim requires citation
- Every interpretive claim must be transparently labeled
- Use confident language for your own claims ("We argue" not "maybe")
- Use careful epistemic language for genuinely uncertain claims

## Common Mistakes

**Structural:**
- Burying the thesis (must appear in Introduction, not Conclusion)
- Writing a descriptive literature summary instead of arguing a position
- Treating counterarguments as optional or perfunctory
- Steelmanning only the weakest opposing view
- Ending with vague or repetitive conclusion instead of implications

**Evidence and argument:**
- Relying on anecdote as primary evidence
- Using only sources that support the position (confirmation bias)
- Making factual claims without citations
- Failing to distinguish consensus from author interpretation
- Over-claiming beyond what evidence supports

**Writing:**
- Excessive hedging weakens the argument (position papers require conviction)
- Passive voice throughout obscures the author's voice
- Emotionally charged language instead of rigorous argumentation

**Submission:**
- Submitting to journals that only accept opinion pieces by invitation without pre-inquiry
- Exceeding word limits (opinion pieces have strict limits, typically 1,500-4,000 words)

## Publication Venue Types

| Type | Word Count | New Data? | Peer Reviewed? |
|------|-----------|-----------|----------------|
| Perspective article | 2,000-4,000 | Sometimes | Usually yes |
| Opinion article | 2,000-2,500 | No | Usually yes |
| Commentary | 1,000-1,500 | No | Usually yes |
| Viewpoint | 1,500-3,000 | No | Usually yes |
| Forum / Essay | 3,000-5,000 | Sometimes | Yes |

**Many high-impact journals publish perspectives only by invitation.** For unsolicited submissions, send a pre-submission inquiry to the editor.

## LaTeX Template

Position papers typically use the target journal's standard template. If writing a working paper or preprint:

```latex
\documentclass[12pt, a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{natbib}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{microtype}
```

Use the author-year citation style (\citet, \citep) common in social sciences and humanities venues that publish position papers.
