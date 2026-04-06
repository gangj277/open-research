import type { WorkspaceContext } from "./state";
import { discoverScholarlySources } from "@/lib/discovery/scholarly-search";
import { loadOpenResearchConfig, getSemanticScholarApiKey, getOpenAlexApiKey } from "@/lib/config/store";

export async function executeSearchExternalSources(
  args: {
    searches?: Array<{ query: string; intent?: string }>;
    num_results?: number;
  },
  ctx: WorkspaceContext
) {
  const searches = args.searches ?? [];
  if (searches.length === 0) {
    return { result: "Error: no search queries provided.", sources: [] };
  }
  const primary = searches[0]!;
  const variations = searches.slice(1).map((item) => item.query);
  const config = await loadOpenResearchConfig().catch(() => null);
  const results = await discoverScholarlySources({
    query: primary.query,
    queryVariations: variations,
    numResults: args.num_results ?? 8,
    filters: ctx.searchFilters,
    semanticScholarApiKey: getSemanticScholarApiKey(config),
    openAlexApiKey: getOpenAlexApiKey(config),
  });
  const summary = results
    .map((result, index) => `${index + 1}. ${result.title} [${result.provider}] ${result.url}`)
    .join("\n");
  return {
    result: summary || "No external sources found.",
    sources: results,
  };
}
