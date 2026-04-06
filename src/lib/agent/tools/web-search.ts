import type { LLMProvider } from "@/lib/llm/provider";
import { searchDuckDuckGo } from "@/lib/search/duckduckgo";
import { searchBrave } from "@/lib/search/brave";
import { fetchAndParseContent } from "@/lib/search/fetch-content";
import { extractBatch, formatExtractionResults, type ExtractionInput, type ExtractionResult } from "@/lib/search/extract";
import { loadOpenResearchConfig } from "@/lib/config/store";

// ── Search Backend Selection ───────────────────────────────────────────────

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function discoverWebResults(query: string, numResults: number): Promise<{ results: SearchHit[]; backend: string }> {
  // Check for Brave API key
  const config = await loadOpenResearchConfig().catch(() => null);
  const braveKey = config?.apiKeys?.brave;

  if (braveKey) {
    const results = await searchBrave(query, braveKey, numResults + 3);
    if (results.length > 0) {
      return {
        results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.description })),
        backend: "brave",
      };
    }
    // Brave failed — fall through to DuckDuckGo
  }

  const results = await searchDuckDuckGo(query, numResults + 3);
  return {
    results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
    backend: "duckduckgo",
  };
}

// ── Web Search Tool Executor ───────────────────────────────────────────────

export async function executeWebSearch(
  args: { target: string; query: string; num_results?: number },
  provider?: LLMProvider,
): Promise<{ result: string }> {
  if (!args.target || !args.query) {
    return { result: "Error: both target and query are required." };
  }

  const numResults = Math.min(args.num_results ?? 5, 8);

  // Phase 1: Discovery — Brave (if key set) or DuckDuckGo (default)
  const { results: searchResults, backend } = await discoverWebResults(args.query, numResults);

  if (searchResults.length === 0) {
    return { result: "No web results found. Try a different query." };
  }

  if (!provider) {
    const summary = searchResults
      .slice(0, numResults)
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");
    return { result: `[${backend}] ${summary}` };
  }

  // Phase 2: Content Acquisition — fetch top pages (concurrent)
  const toFetch = searchResults.slice(0, numResults);
  const contentResults = await Promise.allSettled(
    toFetch.map(async (hit) => {
      const content = await fetchAndParseContent(hit.url);
      if (content) return { hit, text: content.text };
      return null;
    })
  );

  const extractionInputs: ExtractionInput[] = [];
  const titleMap = new Map<string, string>();

  for (const result of contentResults) {
    if (result.status === "fulfilled" && result.value) {
      const { hit, text } = result.value;
      extractionInputs.push({
        title: hit.title,
        content: text,
        url: hit.url,
        target: args.target,
      });
      titleMap.set(hit.url, hit.title);
    }
  }

  if (extractionInputs.length === 0) {
    const summary = toFetch
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");
    return { result: `Could not fetch page content. Search snippets:\n\n${summary}` };
  }

  // Phase 3: Extraction — analyze each page against the target (concurrent)
  const extractions = await extractBatch(extractionInputs, provider);

  // Phase 4: Assembly
  const extracted: Array<{
    title: string;
    url: string;
    extraction: ExtractionResult;
  }> = [];

  for (const [url, extraction] of extractions) {
    if (extraction.relevanceScore >= 2) {
      extracted.push({
        title: titleMap.get(url) ?? url,
        url,
        extraction,
      });
    }
  }

  return { result: formatExtractionResults(extracted) };
}
