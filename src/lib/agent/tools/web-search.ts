import type { LLMProvider } from "@/lib/llm/provider";
import { searchDuckDuckGo } from "@/lib/search/duckduckgo";
import { searchBrave } from "@/lib/search/brave";
import { fetchAndParseContent } from "@/lib/search/fetch-content";
import { extractBatch, formatExtractionResults, type ExtractionInput, type ExtractionResult } from "@/lib/search/extract";
import { loadOpenResearchConfig } from "@/lib/config/store";
import { getProviderCatalog } from "@/lib/llm/provider-catalog";

// ── Adversarial Query Generation (shared pattern) ────────────────────────

const ADVERSARIAL_QUERY_PROMPT = `You generate search queries that find evidence AGAINST a research target. Your queries should surface:
- Direct contradictions or negative results
- Methodological limitations or criticisms
- Alternative explanations for the same phenomena
- Boundary conditions where the target claim fails

Do NOT rephrase the target as a question. Generate queries a skeptical reviewer would use to challenge the claim.`;

const ADVERSARIAL_QUERY_SCHEMA = {
  name: "adversarial_queries",
  schema: {
    type: "object" as const,
    properties: {
      queries: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "1-2 search queries designed to find contradicting or limiting evidence",
      },
    },
    required: ["queries"],
    additionalProperties: false,
  },
};

async function generateAdversarialWebQueries(
  target: string,
  provider: LLMProvider
): Promise<string[]> {
  try {
    const backgroundModel = getProviderCatalog(provider.kind).backgroundModel;
    const response = await provider.callLLM({
      messages: [
        { role: "system", content: ADVERSARIAL_QUERY_PROMPT },
        { role: "user", content: target },
      ],
      model: backgroundModel,
      reasoningEffort: "low",
      temperature: 0,
      maxTokens: 150,
      jsonSchema: ADVERSARIAL_QUERY_SCHEMA,
    });
    const parsed = JSON.parse(response.content) as { queries: string[] };
    return Array.isArray(parsed.queries) ? parsed.queries.slice(0, 2) : [];
  } catch {
    return [];
  }
}

// ── Search Backend Selection ───────────────────────────────────────────────

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function discoverWebResults(query: string, numResults: number): Promise<{ results: SearchHit[]; backend: string }> {
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
  }

  const results = await searchDuckDuckGo(query, numResults + 3);
  return {
    results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
    backend: "duckduckgo",
  };
}

// ── Web Search Tool Executor ───────────────────────────────────────────────

export async function executeWebSearch(
  args: {
    target: string;
    query?: string;
    queries?: string[];
    num_results?: number;
  },
  provider?: LLMProvider,
): Promise<{ result: string }> {
  // Support both single query and queries array
  const userQueries: string[] = args.queries ?? (args.query ? [args.query] : []);
  if (!args.target || userQueries.length === 0) {
    return { result: "Error: both target and query/queries are required." };
  }

  const numResults = Math.min(args.num_results ?? 5, 8);

  // Generate adversarial queries concurrently with primary search
  const adversarialPromise = provider
    ? generateAdversarialWebQueries(args.target, provider)
    : Promise.resolve([]);

  // Phase 1: Discovery — fan out all user queries
  const allSearchPromises = userQueries.map((q) => discoverWebResults(q, numResults));
  const searchResultSets = await Promise.allSettled(allSearchPromises);

  // Collect and deduplicate by URL
  const seenUrls = new Set<string>();
  const allHits: Array<SearchHit & { queryIntent?: string }> = [];

  for (const resultSet of searchResultSets) {
    if (resultSet.status === "fulfilled") {
      for (const hit of resultSet.value.results) {
        if (!seenUrls.has(hit.url)) {
          seenUrls.add(hit.url);
          allHits.push({ ...hit, queryIntent: "primary" });
        }
      }
    }
  }

  // Add adversarial results
  const adversarialQueries = await adversarialPromise;
  for (const aq of adversarialQueries) {
    const { results } = await discoverWebResults(aq, 3);
    for (const hit of results) {
      if (!seenUrls.has(hit.url)) {
        seenUrls.add(hit.url);
        allHits.push({ ...hit, queryIntent: "adversarial" });
      }
    }
  }

  if (allHits.length === 0) {
    return { result: "No web results found. Try a different query." };
  }

  if (!provider) {
    const summary = allHits
      .slice(0, numResults)
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");
    return { result: summary };
  }

  // Phase 2: Content Acquisition — fetch top pages (concurrent)
  const toFetch = allHits.slice(0, numResults + 3);
  const contentResults = await Promise.allSettled(
    toFetch.map(async (hit) => {
      const content = await fetchAndParseContent(hit.url);
      if (content) return { hit, text: content.text };
      return null;
    })
  );

  const extractionInputs: ExtractionInput[] = [];
  const hitMap = new Map<string, (typeof allHits)[number]>();

  for (const result of contentResults) {
    if (result.status === "fulfilled" && result.value) {
      const { hit, text } = result.value;
      extractionInputs.push({
        title: hit.title,
        content: text,
        url: hit.url,
        target: args.target,
      });
      hitMap.set(hit.url, hit);
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
    queryIntent?: string;
  }> = [];

  for (const [url, extraction] of extractions) {
    if (extraction.relevanceScore >= 2) {
      const hit = hitMap.get(url);
      extracted.push({
        title: hit?.title ?? url,
        url,
        extraction,
        queryIntent: hit?.queryIntent,
      });
    }
  }

  return { result: formatExtractionResults(extracted) };
}
