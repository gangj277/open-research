const OPENALEX_BASE_URL = "https://api.openalex.org";

const DEFAULT_SELECT_FIELDS = [
  "id",
  "title",
  "display_name",
  "publication_year",
  "publication_date",
  "cited_by_count",
  "doi",
  "primary_location",
].join(",");

interface OpenAlexSourceLocation {
  display_name?: string | null;
}

interface OpenAlexPrimaryLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  source?: OpenAlexSourceLocation | null;
}

interface OpenAlexWorkRecord {
  id: string;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  cited_by_count?: number | null;
  doi?: string | null;
  primary_location?: OpenAlexPrimaryLocation | null;
}

interface OpenAlexWorksResponse {
  results?: OpenAlexWorkRecord[];
}

export interface OpenAlexWork {
  id: string;
  title: string;
  publicationYear?: number;
  publicationDate?: string;
  citedByCount: number;
  doi?: string;
  source?: string;
  landingPageUrl?: string;
  pdfUrl?: string;
}

export async function searchOpenAlexWorks({
  query,
  apiKey,
  perPage = 10,
  venue,
  minCitationCount,
  fromPublicationDate,
  toPublicationDate,
  publicationType,
  isOpenAccess,
  fetchImpl = fetch,
}: {
  query: string;
  apiKey: string;
  perPage?: number;
  /** Filter by journal/venue name */
  venue?: string[];
  /** Minimum citation count (e.g. 50 → cited_by_count:>50) */
  minCitationCount?: number;
  /** YYYY-MM-DD */
  fromPublicationDate?: string;
  /** YYYY-MM-DD */
  toPublicationDate?: string;
  /** OpenAlex work type (e.g. "article", "review", "preprint") */
  publicationType?: string;
  /** Only open access works */
  isOpenAccess?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<OpenAlexWork[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("query is required");
  }

  if (!apiKey.trim()) {
    throw new Error("apiKey is required");
  }

  // Resolve venue names to OpenAlex source IDs (requires extra API calls)
  const sourceIds = venue && venue.length > 0
    ? await resolveOpenAlexSourceIds(venue, apiKey, fetchImpl)
    : undefined;

  const url = new URL("/works", OPENALEX_BASE_URL);
  url.searchParams.set("search", trimmedQuery);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("select", DEFAULT_SELECT_FIELDS);
  url.searchParams.set("api_key", apiKey);

  const filterParts = buildOpenAlexFilterParts({
    sourceIds,
    minCitationCount,
    fromPublicationDate,
    toPublicationDate,
    publicationType,
    isOpenAccess,
  });
  if (filterParts.length > 0) {
    url.searchParams.set("filter", filterParts.join(","));
  }

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAlex search failed: ${response.status}`);
  }

  const payload = (await response.json()) as OpenAlexWorksResponse;

  return (payload.results ?? []).map((work) => ({
    id: work.id,
    title: work.title ?? work.display_name ?? "Untitled",
    publicationYear:
      typeof work.publication_year === "number"
        ? work.publication_year
        : undefined,
    publicationDate: work.publication_date ?? undefined,
    citedByCount:
      typeof work.cited_by_count === "number" ? work.cited_by_count : 0,
    doi: work.doi ?? undefined,
    source: work.primary_location?.source?.display_name ?? undefined,
    landingPageUrl: work.primary_location?.landing_page_url ?? undefined,
    pdfUrl: work.primary_location?.pdf_url ?? undefined,
  }));
}

function buildOpenAlexFilterParts({
  sourceIds,
  minCitationCount,
  fromPublicationDate,
  toPublicationDate,
  publicationType,
  isOpenAccess,
}: {
  sourceIds?: string[];
  minCitationCount?: number;
  fromPublicationDate?: string;
  toPublicationDate?: string;
  publicationType?: string;
  isOpenAccess?: boolean;
}): string[] {
  const parts: string[] = [];

  if (sourceIds && sourceIds.length > 0) {
    // Use pipe-separated source IDs for OR: "S137773608|S64187185"
    parts.push(
      `primary_location.source.id:${sourceIds.join("|")}`
    );
  }

  if (typeof minCitationCount === "number" && minCitationCount > 0) {
    parts.push(`cited_by_count:>${minCitationCount}`);
  }

  if (fromPublicationDate) {
    parts.push(`from_publication_date:${fromPublicationDate}`);
  }

  if (toPublicationDate) {
    parts.push(`to_publication_date:${toPublicationDate}`);
  }

  if (publicationType) {
    parts.push(`type:${publicationType}`);
  }

  if (isOpenAccess) {
    parts.push("is_oa:true");
  }

  return parts;
}

interface OpenAlexSourceRecord {
  id: string;
  display_name?: string | null;
}

interface OpenAlexSourcesResponse {
  results?: OpenAlexSourceRecord[];
}

/**
 * Resolves venue names (e.g. "Nature", "ACL") to OpenAlex source IDs
 * by searching the /sources endpoint. Takes the top match per venue name.
 */
async function resolveOpenAlexSourceIds(
  venueNames: string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  const lookups = venueNames.map(async (name) => {
    const url = new URL("/sources", OPENALEX_BASE_URL);
    url.searchParams.set("search", name.trim());
    url.searchParams.set("per_page", "1");
    url.searchParams.set("select", "id,display_name");
    url.searchParams.set("api_key", apiKey);

    try {
      const response = await fetchImpl(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return undefined;
      const payload = (await response.json()) as OpenAlexSourcesResponse;
      const topResult = payload.results?.[0];
      if (!topResult) return undefined;
      // Extract short ID from full URL (e.g. "https://openalex.org/S137773608" → "S137773608")
      return topResult.id.replace("https://openalex.org/", "");
    } catch {
      return undefined;
    }
  });

  const results = await Promise.all(lookups);
  return results.filter((id): id is string => id !== undefined);
}
