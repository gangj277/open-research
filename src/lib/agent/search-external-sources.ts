import type { WorkspaceContext } from "./state";
import { discoverScholarlySources } from "@/lib/discovery/scholarly-search";

export async function executeSearchExternalSources(
  args: {
    searches: Array<{ query: string; intent: string }>;
    num_results?: number;
  },
  ctx: WorkspaceContext
) {
  const primary = args.searches[0];
  const variations = args.searches.slice(1).map((item) => item.query);
  const results = await discoverScholarlySources({
    query: primary.query,
    queryVariations: variations,
    numResults: args.num_results ?? 8,
    filters: ctx.searchFilters,
  });
  const summary = results
    .map((result, index) => `${index + 1}. ${result.title} [${result.provider}] ${result.url}`)
    .join("\n");
  return {
    result: summary || "No external sources found.",
    sources: results,
  };
}
