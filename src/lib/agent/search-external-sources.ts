import type { LLMProvider } from "@/lib/llm/provider";
import type { WorkspaceContext } from "./state";
import { discoverScholarlySources } from "@/lib/discovery/scholarly-search";
import { loadOpenResearchConfig, getSemanticScholarApiKey, getOpenAlexApiKey } from "@/lib/config/store";
import { fetchAndParseContent } from "@/lib/search/fetch-content";
import { extractBatch, formatExtractionResults, type ExtractionInput, type ExtractionResult } from "@/lib/search/extract";

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

  // Phase 1: Discovery — find papers via federated search
  const results = await discoverScholarlySources({
    query: primary.query,
    queryVariations: variations,
    numResults: args.num_results ?? 8,
    filters: ctx.searchFilters,
    semanticScholarApiKey: getSemanticScholarApiKey(config),
    openAlexApiKey: getOpenAlexApiKey(config),
  });

  if (results.length === 0) {
    return { result: "No papers found.", sources: [] };
  }

  // If no provider, fall back to metadata-only (can't run extraction)
  if (!provider) {
    const summary = results
      .map((r, i) => `${i + 1}. ${r.title} [${r.provider}] ${r.url}`)
      .join("\n");
    return { result: summary || "No papers found.", sources: results };
  }

  // Phase 2: Content Acquisition — fetch abstracts, PDFs, or HTML (concurrent)
  const contentResults = await Promise.allSettled(
    results.map(async (source) => {
      // Priority 1: arXiv abstract (zero network cost)
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
  const sourceMap = new Map<string, typeof results[number]>();

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
    // Could not fetch any content — fall back to metadata
    const summary = results
      .map((r, i) => `${i + 1}. ${r.title} [${r.provider}] ${r.url}`)
      .join("\n");
    return {
      result: `Could not fetch content from any papers. Metadata only:\n${summary}`,
      sources: results,
    };
  }

  // Phase 3: Extraction — analyze each paper against the target (concurrent)
  const extractions = await extractBatch(extractionInputs, provider);

  // Phase 4: Assembly — build rich result
  const extracted: Array<{
    title: string;
    url: string;
    provider?: string;
    extraction: ExtractionResult;
  }> = [];

  for (const [url, extraction] of extractions) {
    const source = sourceMap.get(url);
    if (source && extraction.relevanceScore >= 2) {
      extracted.push({
        title: source.title,
        url: source.url,
        provider: source.provider,
        extraction,
      });
    }
  }

  const formatted = formatExtractionResults(extracted);

  return {
    result: formatted,
    sources: results,
  };
}
