# Search with Target Extraction

## Problem

Both search tools are broken by design:

**`search_external_sources`** returns a list of titles and URLs — nothing more. The agent then has to make 5-8 separate `fetch_url` or `read_pdf` calls to actually learn what's in the papers, each dumping raw content into its context. Slow, wasteful, and the agent does the extraction work itself.

**`web_search`** doesn't exist yet. The agent can't discover general web content at all.

Both problems have the same root cause: **search returns pointers, not answers.** The agent needs findings, not URLs.

## Design Principle

**Every search tool should be a pipeline: discover → fetch → extract → return findings.**

The `target` field is the key innovation. It tells a cheap extraction model (gpt-5.4-mini) exactly what to pull from each result. The main agent never sees raw content — it gets condensed, target-focused findings with source attribution.

This pattern applies to both academic search and web search identically.

## Shared Extraction Layer

Both `search_external_sources` and `web_search` share the same extraction step. Extract it into a reusable module:

### `src/lib/search/extract.ts`

```typescript
interface ExtractionInput {
  url: string;
  title: string;
  text: string;       // Raw page/abstract text (truncated to ~8K chars)
  target: string;     // What to extract
}

interface ExtractionResult {
  url: string;
  title: string;
  finding: string;    // Extracted content, or empty if irrelevant
  relevant: boolean;
}

async function extractFromSources(
  inputs: ExtractionInput[],
  provider: LLMProvider,
  signal?: AbortSignal
): Promise<ExtractionResult[]>
```

**How it works:**
- Takes N pages + a target question
- Calls gpt-5.4-mini concurrently on each (`Promise.allSettled`)
- Each call: "Extract information relevant to `{target}` from this page. If nothing relevant, respond IRRELEVANT."
- Filters out irrelevant results
- Returns condensed findings

**Extraction prompt for gpt-5.4-mini:**

```
You are an information extractor. Given a target question and source text, extract ONLY information that directly answers the target.

Rules:
- 2-5 sentences max. Be specific — include exact numbers, methods, findings, or quotes.
- If the source has nothing relevant to the target, respond with exactly: IRRELEVANT
- Do not summarize the source generally — only extract what the target asks for.
- Prefer concrete claims over vague descriptions.
```

---

## Tool 1: `search_external_sources` (upgrade)

### Current Behavior (broken)

Agent calls → gets back:
```
1. Attention Is All You Need [arxiv] https://arxiv.org/...
2. BERT: Pre-training of Deep Bidirectional Transformers [semantic-scholar] https://...
```

Just titles and URLs. Useless without follow-up reads.

### New Behavior

Add optional `target` field. When provided, the tool fetches abstracts/content and runs extraction:

```json
{
  "searches": [{ "query": "transformer attention efficiency improvements" }],
  "target": "What specific efficiency improvements have been proposed for transformer attention and what speedup do they achieve",
  "num_results": 5
}
```

Returns:
```
Based on 4 papers:

1. FlashAttention proposes IO-aware exact attention that achieves 2-4x wall-clock
   speedup over standard attention by reducing HBM reads/writes. Benchmarked on
   GPT-2 training with 15% end-to-end speedup.
   — "FlashAttention: Fast and Memory-Efficient Exact Attention" (Dao et al., 2022) [arxiv]
     https://arxiv.org/abs/2205.14135

2. Linear attention (Katharopoulos et al., 2020) reduces O(n²) to O(n) via kernel
   feature maps, but with 1-2% quality degradation on language modeling tasks.
   — "Transformers are RNNs" [semantic-scholar]
     https://semanticscholar.org/paper/...

3. ...

Sources:
- FlashAttention: https://arxiv.org/abs/2205.14135
- Transformers are RNNs: https://semanticscholar.org/paper/...
```

### Pipeline

```
1. Run existing search pipeline (arXiv + Semantic Scholar + OpenAlex)
   → 8 normalized results with URLs, pdfUrls, and arXiv summaries
2. For each result, fetch content (concurrent via Promise.allSettled):
   - If arXiv paper → use the abstract/summary already in the API response (free, no fetch needed)
   - If pdfUrl exists → download PDF to buffer, run pdfjs extraction, take first ~8K chars
   - If html url → HTTP GET, cheerio htmlToText, take first ~8K chars
   - 10s timeout per fetch, failures skipped
3. Run shared extraction layer with target (gpt-5.4-mini, concurrent)
4. Format findings with citations and source URLs
```

### PDF Handling

Academic search results frequently link to PDFs directly (arXiv, open access journals). The content fetcher must handle PDF URLs:

```typescript
// In src/lib/search/fetch-content.ts

async function fetchContent(url: string, pdfUrl?: string): Promise<string | null> {
  const targetUrl = pdfUrl ?? url;
  const response = await fetch(targetUrl, { timeout: 10_000 });
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/pdf") || targetUrl.endsWith(".pdf")) {
    // Download PDF to buffer, extract text via pdfjs
    const buffer = await response.arrayBuffer();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    // Extract first 5 pages max (~8K chars typically covers abstract + intro + results)
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n\n").slice(0, 8000);
  }

  if (contentType.includes("text/html")) {
    const html = await response.text();
    return htmlToText(html).slice(0, 8000);  // Reuse existing cheerio extractor
  }

  // Plain text or other
  const text = await response.text();
  return text.slice(0, 8000);
}
```

Key: `pdfUrl` takes priority over `url` when available. arXiv results already have summaries so they skip the fetch entirely.

### Schema Change

`target` is **required**. There's no reason to search without knowing what you need.

```typescript
{
  name: "search_external_sources",
  parameters: {
    properties: {
      searches: { /* existing */ },
      num_results: { /* existing */ },
      target: {
        type: "string",
        description:
          "What specific information to extract from found papers. " +
          "The tool fetches abstracts and PDFs, then extracts only what matches your target. " +
          "Be specific: 'What speedups do efficient attention methods achieve' not 'attention'.",
      },
    },
    required: ["searches", "target"],
  },
}
```

---

## Tool 2: `web_search` (new)

### Behavior

```json
{
  "query": "pandas merge vs join performance large dataframes",
  "target": "Which operation is faster for large dataframes and by how much"
}
```

Returns:
```
Based on 3 sources:

1. For index-based operations, join() is ~2.3x faster than merge() on 1M rows
   because it avoids the column-matching overhead. For column-based joins, merge()
   is the only option.
   — "Pandas Merge vs Join Explained" (realpython.com)
     https://realpython.com/pandas-merge-join/

2. With sort=False on pre-sorted data, merge() performance becomes comparable to
   join(). The default sort=True adds O(n log n) overhead.
   — "Performance of different join methods" (stackoverflow.com)
     https://stackoverflow.com/questions/...

Sources:
- https://realpython.com/pandas-merge-join/
- https://stackoverflow.com/questions/...
```

### Pipeline

```
1. Search: DuckDuckGo HTML scrape (default) or Tavily API (if key set)
   → 8-10 results [{title, url, snippet}]
2. Rank snippets against target, select top N (default 3, max 5)
   Skip PDFs, videos, paywalled sites
3. Fetch: HTTP GET each URL, cheerio extract, truncate to ~8K chars
   Concurrent via Promise.allSettled, 10s timeout
4. Extract: shared extraction layer with target (gpt-5.4-mini)
5. Format findings with source attribution
```

### Schema

```typescript
{
  name: "web_search",
  description:
    "Search the web and extract targeted information from results. " +
    "Returns condensed findings, not raw pages. " +
    "Use for documentation, tools, datasets, code examples, blogs — anything non-academic. " +
    "For academic papers, use search_external_sources instead.",
  parameters: {
    properties: {
      query: {
        type: "string",
        description: "Search query",
      },
      target: {
        type: "string",
        description:
          "What specific information to extract. Be precise. " +
          "Good: 'How to configure num_workers in PyTorch DataLoader for multi-GPU' " +
          "Bad: 'PyTorch information'",
      },
      num_results: {
        type: "number",
        description: "Pages to deep-read. Default 3, max 5.",
      },
    },
    required: ["query", "target"],
  },
}
```

### Search Backends

**DuckDuckGo (default, no API key):**
- POST to `html.duckduckgo.com/html/` with `q` param
- Parse with cheerio: `.result__title`, `.result__snippet`, `.result__url`
- Returns 8-10 organic results
- No rate limit for reasonable usage

**Tavily (optional, with API key):**
- POST to `https://api.tavily.com/search`
- Body: `{ query, max_results: 8 }`
- Higher quality, pre-extracted snippets
- Enable via `/api-keys tavily <key>`

---

## System Prompt Update

Replace current tools list entry:

```
- `search_external_sources` — search academic papers with target extraction (arXiv, Semantic Scholar, OpenAlex)
- `web_search` — search the web with target extraction (docs, blogs, repos, datasets)
```

Add to operating principles:

```
- Use `search_external_sources` for academic papers. Use `web_search` for everything else.
- Always provide a `target` field when searching — it tells the extraction engine what to pull from each result.
  Without a target, you get titles and URLs. With a target, you get findings.
```

---

## Token Economics

### Academic Search (search_external_sources)

**Before (no target):** Agent gets 8 titles + URLs (~200 tokens). Then calls `read_pdf` or `fetch_url` on 3-5 papers → 15K-50K tokens of raw content in its context.

**After (with target):** Agent gets 3-5 extracted findings (~500-800 tokens). gpt-5.4-mini processes the raw content separately (~6K mini-model tokens, cheap). **95%+ reduction** in main agent context usage.

### Web Search

**Without this tool:** Agent calls `fetch_url` on guessed URLs, often hitting wrong pages. Each page ~10-20K tokens.

**With this tool:** Agent gets 3 extracted findings (~500 tokens). **97%+ reduction.**

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/search/extract.ts` | Shared extraction layer (gpt-5.4-mini concurrent extraction) |
| `src/lib/search/fetch-content.ts` | Content fetcher: handles HTML pages, PDFs from URLs, arXiv abstracts. Reuses existing `htmlToText` from fetch-url and `pdfjs` from fs/pdf |
| `src/lib/search/duckduckgo.ts` | DuckDuckGo HTML scraper |
| `src/lib/search/tavily.ts` | Tavily API client (optional upgrade) |
| `src/lib/agent/tools/web-search.ts` | web_search tool executor (pipeline orchestrator) |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/agent/search-external-sources.ts` | Add optional `target` param, call extraction layer when provided |
| `src/lib/agent/tool-schemas.ts` | Add `web_search` schema, add `target` field to `search_external_sources` |
| `src/lib/agent/tool-dispatcher.ts` | Add `web_search` case |
| `src/lib/agent/runtime.ts` | Update system prompt with search guidance |
| `src/lib/config/store.ts` | Add `tavily` API key storage |
| `src/tui/hooks/use-slash-commands.ts` | Add `tavily` to `/api-keys` handler |
| `src/tui/commands.ts` | Add `tavily` subcommand hint |
| `src/tui/helpers/tool-summary.ts` | Add `web_search` grouping |

---

## Edge Cases

**No target provided (search_external_sources):** Returns titles + URLs as before. Backward compatible.

**All extractions IRRELEVANT:** "Found N papers/pages but none contained information matching your target."

**Fetch failures:** `Promise.allSettled` — failed fetches are skipped. If all fail: "Could not fetch content from any results."

**arXiv papers already have abstracts:** The arXiv provider returns `summary` (abstract) in the raw response. Use that directly instead of fetching the page — saves a network call.

**PDF extraction:** Use existing `read_pdf` logic for papers with `pdfUrl`. Truncate to first ~8K chars (enough for abstract + introduction + results).

**Rate limiting:** DuckDuckGo HTML endpoint is stable but could CAPTCHA on abuse. Cache results by query hash for 5 minutes.

**Parallel safety:** Both tools are read-only → parallel-safe.

## Testing

1. `search_external_sources` with target — verify extracted findings returned
2. `search_external_sources` without target — verify backward compat (titles + URLs)
3. `web_search` with DuckDuckGo — verify results extracted
4. `web_search` with Tavily key — verify upgrade works
5. Bad query with no results — verify graceful message
6. All pages irrelevant — verify IRRELEVANT filtering
7. Mixed fetch failures — verify partial results returned
