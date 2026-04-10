import type { LLMProvider } from "@/lib/llm/provider";
import type { WorkspaceContext } from "./state";
import { discoverScholarlySources, type ScholarlyDiscoveredSource } from "@/lib/discovery/scholarly-search";
import { loadOpenResearchConfig, getSemanticScholarApiKey, getOpenAlexApiKey } from "@/lib/config/store";
import { fetchAndParseContent } from "@/lib/search/fetch-content";
import { extractBatch, formatExtractionResults, type ExtractionInput, type ExtractionResult } from "@/lib/search/extract";
import { getProviderCatalog } from "@/lib/llm/provider-catalog";

// ── Adversarial Query Generation ─────────────────────────────────────────

const ADVERSARIAL_QUERY_PROMPT = `Generate 2-3 academic search queries to find evidence AGAINST this research claim. Target:
- Negative results or failed replications
- Methodological criticisms
- Alternative explanations
- Boundary conditions where the claim breaks

Output search queries only. Do not rephrase the claim as a question.`;

const ADVERSARIAL_QUERY_SCHEMA = {
  name: "adversarial_queries",
  schema: {
    type: "object" as const,
    properties: {
      queries: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "2-3 search queries designed to find contradicting or limiting evidence",
      },
    },
    required: ["queries"],
    additionalProperties: false,
  },
};

async function generateAdversarialQueries(
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
      maxTokens: 200,
      jsonSchema: ADVERSARIAL_QUERY_SCHEMA,
    });
    const parsed = JSON.parse(response.content) as { queries: string[] };
    return Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [];
  } catch {
    return [];
  }
}

// ── Abstract Relevance Pre-Filter ────────────────────────────────────────

const ABSTRACT_FILTER_PROMPT = `Filter paper abstracts for relevance to this research target.

Include a paper if its abstract mentions:
- Evidence (data, findings, results) related to the target
- Methods or approaches used to study the target topic
- Theories or frameworks that contextualize the target
- Contradictions or limitations relevant to the target

Exclude only papers clearly about an unrelated topic. When uncertain, include.`;

const ABSTRACT_FILTER_SCHEMA = {
  name: "abstract_relevance",
  schema: {
    type: "object" as const,
    properties: {
      relevant_ids: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "IDs of papers whose abstracts indicate relevance to the target",
      },
    },
    required: ["relevant_ids"],
    additionalProperties: false,
  },
};

async function filterByAbstractRelevance(
  target: string,
  papers: Array<{ id: string; title: string; abstract: string }>,
  provider: LLMProvider
): Promise<Set<string>> {
  if (papers.length === 0) return new Set();

  try {
    const backgroundModel = getProviderCatalog(provider.kind).backgroundModel;
    const paperList = papers
      .map((p) => `[${p.id}] "${p.title}"\n${p.abstract.slice(0, 500)}`)
      .join("\n\n");

    const response = await provider.callLLM({
      messages: [
        { role: "system", content: `${ABSTRACT_FILTER_PROMPT}\n\nResearch target: ${target}` },
        { role: "user", content: paperList },
      ],
      model: backgroundModel,
      reasoningEffort: "low",
      temperature: 0,
      maxTokens: 300,
      jsonSchema: ABSTRACT_FILTER_SCHEMA,
    });
    const parsed = JSON.parse(response.content) as { relevant_ids: string[] };
    return new Set(Array.isArray(parsed.relevant_ids) ? parsed.relevant_ids : []);
  } catch {
    // If pre-filter fails, include all papers (safe fallback)
    return new Set(papers.map((p) => p.id));
  }
}

// ── Main Search Pipeline ─────────────────────────────────────────────────

export async function executeSearchExternalSources(
  args: {
    target: string;
    searches?: Array<{ query: string; intent?: string }>;
    num_results?: number;
  },
  ctx: WorkspaceContext,
  provider?: LLMProvider,
) {
  const searches = args.searches ?? [];
  if (searches.length === 0) {
    return { result: "Error: no search queries provided.", sources: [] };
  }
  if (!args.target) {
    return { result: "Error: target is required. Specify what information you need from the papers.", sources: [] };
  }

  const primary = searches[0]!;
  const variations = searches.slice(1).map((item) => item.query);
  const config = await loadOpenResearchConfig().catch(() => null);
  const numResults = args.num_results ?? 8;

  // Generate adversarial queries concurrently with the primary search
  const adversarialPromise = provider
    ? generateAdversarialQueries(args.target, provider)
    : Promise.resolve([]);

  // Phase 1: Discovery — find papers via federated search (user queries)
  const primaryResults = await discoverScholarlySources({
    query: primary.query,
    queryVariations: variations,
    numResults,
    filters: ctx.searchFilters,
    semanticScholarApiKey: getSemanticScholarApiKey(config),
    openAlexApiKey: getOpenAlexApiKey(config),
  });

  // Phase 1b: Run adversarial queries (these were generated concurrently)
  const adversarialQueries = await adversarialPromise;
  let adversarialResults: ScholarlyDiscoveredSource[] = [];

  if (adversarialQueries.length > 0) {
    adversarialResults = await discoverScholarlySources({
      query: adversarialQueries[0]!,
      queryVariations: adversarialQueries.slice(1),
      numResults: Math.min(4, numResults), // Fewer adversarial results — they supplement, not replace
      filters: ctx.searchFilters,
      semanticScholarApiKey: getSemanticScholarApiKey(config),
      openAlexApiKey: getOpenAlexApiKey(config),
    });
  }

  // Merge and deduplicate by URL
  const seenUrls = new Set<string>();
  const allResults: Array<ScholarlyDiscoveredSource & { queryIntent?: string }> = [];

  for (const r of primaryResults) {
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      allResults.push({ ...r, queryIntent: "primary" });
    }
  }
  for (const r of adversarialResults) {
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      allResults.push({ ...r, queryIntent: "adversarial" });
    }
  }

  if (allResults.length === 0) {
    return { result: "No papers found.", sources: [] };
  }

  // If no provider, fall back to metadata-only (can't run extraction)
  if (!provider) {
    const summary = allResults
      .map((r, i) => `${i + 1}. ${r.title} [${r.provider}] ${r.url}`)
      .join("\n");
    return { result: summary || "No papers found.", sources: allResults };
  }

  // Phase 1c: Abstract-first relevance pre-filter
  // Papers with abstracts get pre-filtered by LLM; others go straight to content fetch
  const papersWithAbstracts = allResults
    .filter((r) => r.abstract && r.abstract.length > 50)
    .map((r, i) => ({ id: String(i), title: r.title, abstract: r.abstract! }));

  let relevantIds: Set<string>;
  if (papersWithAbstracts.length >= 3) {
    // Only run pre-filter if we have enough abstracts to make it worthwhile
    relevantIds = await filterByAbstractRelevance(args.target, papersWithAbstracts, provider);
  } else {
    relevantIds = new Set(papersWithAbstracts.map((p) => p.id));
  }

  // Build the set of papers to fetch full content for
  const papersToFetch = allResults.filter((r, i) => {
    if (!r.abstract || r.abstract.length <= 50) return true; // No abstract → always fetch
    return relevantIds.has(String(papersWithAbstracts.findIndex((p) => p.title === r.title)));
  });

  // Phase 2: Content Acquisition — fetch abstracts, PDFs, or HTML (concurrent)
  const contentResults = await Promise.allSettled(
    papersToFetch.map(async (source) => {
      // Priority 1: abstract (zero network cost)
      if (source.abstract) {
        return { source, text: source.abstract };
      }
      // Priority 2: PDF URL
      if (source.pdfUrl) {
        const content = await fetchAndParseContent(source.pdfUrl);
        if (content) return { source, text: content.text };
      }
      // Priority 3: Landing page URL
      if (source.url) {
        const content = await fetchAndParseContent(source.url);
        if (content) return { source, text: content.text };
      }
      return null;
    })
  );

  // Collect successful fetches
  const extractionInputs: ExtractionInput[] = [];
  const sourceMap = new Map<string, (typeof allResults)[number]>();

  for (const result of contentResults) {
    if (result.status === "fulfilled" && result.value) {
      const { source, text } = result.value;
      extractionInputs.push({
        title: source.title,
        content: text,
        url: source.url,
        target: args.target,
      });
      sourceMap.set(source.url, source);
    }
  }

  if (extractionInputs.length === 0) {
    const summary = allResults
      .map((r, i) => `${i + 1}. ${r.title} [${r.provider}] ${r.url}`)
      .join("\n");
    return {
      result: `Could not fetch content from any papers. Metadata only:\n${summary}`,
      sources: allResults,
    };
  }

  // Phase 3: Extraction — analyze each paper against the target (concurrent)
  const extractions = await extractBatch(extractionInputs, provider);

  // Phase 4: Assembly — build rich result with quality metadata
  const extracted: Array<{
    title: string;
    url: string;
    provider?: string;
    extraction: ExtractionResult;
    year?: number;
    venue?: string;
    citationCount?: number;
    queryIntent?: string;
  }> = [];

  for (const [url, extraction] of extractions) {
    const source = sourceMap.get(url);
    if (source && extraction.relevanceScore >= 2) {
      extracted.push({
        title: source.title,
        url: source.url,
        provider: source.provider,
        extraction,
        year: source.paperQuality?.publication?.year,
        venue: source.venue ?? source.paperQuality?.publication?.venue,
        citationCount: source.citationCount ?? source.paperQuality?.metrics?.citationCount,
        queryIntent: source.queryIntent,
      });
    }
  }

  const formatted = formatExtractionResults(extracted);

  return {
    result: formatted,
    sources: allResults,
  };
}
