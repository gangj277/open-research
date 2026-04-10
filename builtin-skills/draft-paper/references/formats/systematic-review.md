# Systematic Review Structure (PRISMA 2020)

## Overview

A systematic review uses pre-specified, reproducible methods to identify, appraise, and synthesize ALL relevant evidence on a defined question. PRISMA 2020 (Preferred Reporting Items for Systematic reviews and Meta-Analyses) is the current reporting standard with a 27-item checklist.

## When to Use This Structure

✅ Synthesizing existing evidence on a defined research question
✅ Informing clinical practice, policy, or future research directions
✅ When a rigorous, reproducible evidence synthesis is needed

❌ When original empirical data is being reported → use IMRAD
❌ When a quick narrative overview suffices → use narrative review
❌ When arguing a position → use position paper structure

## Pre-Review Requirements

### Protocol Registration (PROSPERO)
- Register BEFORE data extraction begins (post-hoc registration reduces credibility)
- Include: title, eligibility criteria, search strategy overview, synthesis methods, conflicts
- Upload full detailed protocol as PDF
- Report PROSPERO registration number in abstract AND methods

### Research Question Framework (PICO/PICOS)
- **P**opulation, **I**ntervention, **C**omparison, **O**utcome, [**S**tudy design]
- For observational: **PECO** (Exposure instead of Intervention)
- Each PICO element becomes an inclusion/exclusion criterion

## Required Sections

### ABSTRACT (12-item mini-checklist)
Background, objectives, eligibility criteria, information sources, risk of bias method, synthesis methods, included studies count, results summary, limitations, conclusions, funding, registration number

### INTRODUCTION
- **Rationale** (PRISMA Item 3): Why was this review needed?
- **Objectives** (Item 4): Explicit research questions or hypotheses

### METHODS (Most Detailed Section — Items 5-16)

1. **Eligibility Criteria** (Item 5)
   - All inclusion/exclusion criteria specified in advance
   - Cover: population, intervention/exposure, comparator, outcomes, study designs, settings, languages, publication years, grey literature policy

2. **Information Sources** (Item 6)
   - Every database searched (with platform name)
   - Date of last search
   - Grey literature sources, trial registries, reference list checking, citation searching, expert consultation

3. **Search Strategy** (Item 7)
   - Full reproducible search for at least one database (ideally all)
   - Include: search terms, Boolean operators, field codes, date/language filters
   - Full strategy in appendix or supplementary material

4. **Selection Process** (Item 8)
   - Number of reviewers, whether independent and in duplicate
   - Disagreement resolution method
   - Automation tools used (Covidence, Rayyan, etc.)

5. **Data Collection Process** (Item 9)
   - Data extraction form design
   - Number of extractors, dual extraction, discrepancy resolution
   - Whether study authors were contacted for missing data

6. **Data Items** (Item 10)
   - Every variable extracted with rationale

7. **Risk of Bias Assessment** (Item 11)
   - Named tool and version (see tools table below)
   - Domains assessed, number of reviewers, independence, disagreement resolution

8. **Effect Measures** (Item 12)
   - For meta-analyses: statistical measure (OR, RR, MD, SMD, etc.)

9. **Synthesis Methods** (Items 13a-13f — 6 sub-items)
   - What studies were combined and how
   - Tabulation and visualization methods
   - Meta-analysis parameters OR narrative synthesis approach
   - Heterogeneity exploration (I², Cochran Q, subgroup analyses)
   - Sensitivity analyses
   - Reporting bias assessment (funnel plots, Egger's test if ≥10 studies)

10. **Certainty Assessment** (Item 15)
    - System used to assess certainty of evidence (typically GRADE)

### RESULTS (Items 16-23)

1. **Study Selection** — with PRISMA flow diagram (mandatory)
2. **Study Characteristics** — summary table of all included studies
3. **Risk of Bias Results** — per study and overall
4. **Synthesis Results** — per outcome
5. **Reporting Bias Results**
6. **Certainty of Evidence Results**

### DISCUSSION (Items 24-26)
- Interpretation in context of prior reviews and clinical/policy context
- Limitations of the review itself (search limitations, methodological limitations)
- Conclusions with practical implications

### OTHER INFORMATION (Item 27)
- Registration info (PROSPERO number)
- Protocol accessibility
- Protocol amendments (when and why)
- Funding, conflicts, data availability
- Automation tools used

## PRISMA Flow Diagram (Mandatory)

Four phases tracked in TWO columns (2020 update):

**Column 1: Database Records**
- Records identified from databases (by database name)
- Records after deduplication
- Records screened → excluded (with reasons)
- Full-text reports assessed → excluded (with specific reasons per exclusion)

**Column 2: Other Sources**
- Records from citation searching, grey literature, expert consultation
- Reports sought → not retrieved → assessed → excluded

**Merge point**: Studies included in review
- Report: number of studies AND number of reports (one study may have multiple reports)

## Risk of Bias Tools

| Study Design | Tool | Notes |
|-------------|------|-------|
| Randomized Controlled Trials | RoB 2 (Cochrane, 2019) | 5 domains; low/some concerns/high |
| Non-randomized interventions | ROBINS-I | 7 domains; requires epidemiological expertise |
| Observational (cohort, case-control) | Newcastle-Ottawa Scale (NOS) | Faster but less granular |
| Diagnostic accuracy studies | QUADAS-2 | |
| Systematic reviews being appraised | AMSTAR-2 | |
| Qualitative studies | CASP Qualitative Checklist | |

## Meta-Analysis vs Narrative Synthesis

### Use meta-analysis when:
- Studies address same PICO elements
- Compatible measurement scales and time points
- Adequate methodological quality
- Statistical heterogeneity acceptably low (I² generally <50-60%)

### Use narrative synthesis when:
- Significant clinical or methodological heterogeneity
- Incompatible outcome measures
- Quantitative pooling would be misleading
- Question is about mechanisms, context, or complexity
- Only 2-3 studies exist (pooling can mislead)

### Often use both:
Meta-analysis for comparable outcomes; narrative synthesis where pooling is inappropriate.

## Common Mistakes

**Methodological:**
- Beginning without a registered protocol
- Searching too few databases (minimum 2-3 required)
- Omitting grey literature (unpublished studies, conference abstracts)
- Single reviewer for screening or extraction (dual independent is standard)
- Not pre-specifying outcomes (outcome switching is a serious validity threat)
- Wrong risk of bias tool for study design
- Performing meta-analysis despite high heterogeneity without investigation

**Reporting:**
- Failing to report full search strategy
- Missing PRISMA flow diagram
- No certainty of evidence assessment (GRADE)
- Not reporting protocol amendments with dates
- Omitting automation tools used (Covidence, Rayyan, ML screening)

**Reviewer expectations:**
- Full, reproducible search strategy in appendix
- Completed PRISMA checklist submitted alongside manuscript
- PROSPERO registration number in abstract and methods
- Risk of bias summary figure AND table
- Transparent reporting of both study limitations AND review limitations
