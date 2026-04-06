import {
  searchOpenAlexWorks,
} from "@/lib/discovery/openalex";
import type { PaperQualityMeta } from "@/lib/discovery/paper-quality";
import {
  searchSemanticScholarPapers,
} from "@/lib/discovery/semantic-scholar";
import { searchArxivPapers } from "@/lib/discovery/arxiv";
import {
  type SearchFilterConfig,
  toSemanticScholarPublicationTypes,
  toSemanticScholarDateRange,
  toOpenAlexType,
} from "@/lib/discovery/search-filters";
import { uniqueQueries, isCandidate } from "./scholarly-utils";
import {
  normalizeOpenAlexWork,
  normalizeSemanticScholarPaper,
  normalizeArxivPaper,
  stripInternalFields,
  type NormalizedCandidate,
} from "./scholarly-normalize";
import { mergeAndRankCandidates } from "./scholarly-dedup";

export type ScholarlyProvider = "openalex" | "semantic-scholar" | "arxiv";

export interface ScholarlyDiscoveredSource {
  title: string;
  url: string;
  pdfUrl?: string;
  abstract?: string;
  publishedDate?: string;
  author?: string;
  provider: ScholarlyProvider;
  providers: ScholarlyProvider[];
  doi?: string;
  arxivId?: string;
  citationCount?: number;
  venue?: string;
  paperQuality?: PaperQualityMeta;
}

export type DiscoveredSource = ScholarlyDiscoveredSource;

interface ScholarlySearchClients {
  searchOpenAlexWorks?: typeof searchOpenAlexWorks;
  searchSemanticScholarPapers?: typeof searchSemanticScholarPapers;
  searchArxivPapers?: typeof searchArxivPapers;
}

export async function discoverScholarlySources({
  query,
  numResults = 15,
  queryVariations = [],
  filters,
  openAlexApiKey = process.env.OPENALEX_API_KEY,
  semanticScholarApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY,
  clients = {},
}: {
  query: string;
  numResults?: number;
  queryVariations?: string[];
  /** Optional search filters (venues, citation threshold, dates, etc.) */
  filters?: SearchFilterConfig;
  openAlexApiKey?: string;
  semanticScholarApiKey?: string;
  clients?: ScholarlySearchClients;
}): Promise<ScholarlyDiscoveredSource[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("query is required");
  }

  const searchQueries = uniqueQueries([trimmedQuery, ...queryVariations]).slice(0, 6);
  // Overfetch per query — dedup will collapse duplicates across queries and providers,
  // so we need a much larger raw pool than the final numResults target.
  const perQueryResults = 8;

  const openAlexSearch = clients.searchOpenAlexWorks ?? searchOpenAlexWorks;
  const semanticScholarSearch =
    clients.searchSemanticScholarPapers ?? searchSemanticScholarPapers;
  const arxivSearch = clients.searchArxivPapers ?? searchArxivPapers;

  const tasks: Array<Promise<NormalizedCandidate[]>> = [];

  if (openAlexApiKey?.trim()) {
    for (let qi = 0; qi < searchQueries.length; qi++) {
      const qIdx = qi;
      tasks.push(
        openAlexSearch({
          query: searchQueries[qIdx],
          apiKey: openAlexApiKey.trim(),
          perPage: perQueryResults,
          venue: filters?.venues,
          minCitationCount: filters?.minCitationCount,
          fromPublicationDate: filters?.dateFrom,
          toPublicationDate: filters?.dateTo,
          publicationType: toOpenAlexType(filters?.publicationType),
          isOpenAccess: filters?.openAccessOnly,
        }).then((works) =>
          works.map(normalizeOpenAlexWork).filter(isCandidate).map((c) => ({ ...c, queryIndex: qIdx }))
        )
      );
    }
  }

  for (let qi = 0; qi < searchQueries.length; qi++) {
    const qIdx = qi;
    tasks.push(
      semanticScholarSearch({
        query: searchQueries[qIdx],
        apiKey: semanticScholarApiKey?.trim(),
        maxResults: perQueryResults,
        sort: "citationCount:desc",
        fallbackToPublicSearchOnForbidden: true,
        venue: filters?.venues,
        minCitationCount: filters?.minCitationCount,
        publicationTypes: toSemanticScholarPublicationTypes(filters?.publicationType),
        publicationDateOrYear: toSemanticScholarDateRange(filters?.dateFrom, filters?.dateTo),
        openAccessPdfOnly: filters?.openAccessOnly,
      }).then((result) =>
        result.papers.map(normalizeSemanticScholarPaper).filter(isCandidate).map((c) => ({ ...c, queryIndex: qIdx }))
      )
    );
  }

  // arXiv only supports date range natively.
  // If venue filter is set, skip arXiv entirely (it has no venue/journal concept).
  const skipArxiv = filters?.venues && filters.venues.length > 0;

  if (!skipArxiv) {
    const arxivDateRange =
      filters?.dateFrom || filters?.dateTo
        ? {
            from: (filters.dateFrom ?? "2000-01-01").replace(/-/g, ""),
            to: (filters.dateTo ?? new Date().toISOString().slice(0, 10)).replace(/-/g, ""),
          }
        : undefined;

    for (let qi = 0; qi < searchQueries.length; qi++) {
      const qIdx = qi;
      tasks.push(
        arxivSearch({
          query: searchQueries[qIdx],
          maxResults: perQueryResults,
          sortBy: "relevance",
          sortOrder: "descending",
          submittedDateRange: arxivDateRange,
        }).then((result) =>
          result.papers.map(normalizeArxivPaper).filter(isCandidate).map((c) => ({ ...c, queryIndex: qIdx }))
        )
      );
    }
  }

  const settled = await Promise.allSettled(tasks);
  const candidates = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  return mergeAndRankCandidates(candidates, numResults, searchQueries.length)
    .map(stripInternalFields);
}
