const SEMANTIC_SCHOLAR_BASE_URL = "https://api.semanticscholar.org";

const DEFAULT_FIELDS = [
  "paperId",
  "title",
  "url",
  "externalIds",
  "openAccessPdf",
  "venue",
  "year",
  "publicationDate",
  "citationCount",
  "influentialCitationCount",
  "referenceCount",
].join(",");

interface SemanticScholarOpenAccessPdf {
  url?: string | null;
}

interface SemanticScholarExternalIds {
  DOI?: string | null;
  ArXiv?: string | null;
  [key: string]: string | number | null | undefined;
}

interface SemanticScholarBulkPaperRecord {
  paperId: string;
  title?: string | null;
  url?: string | null;
  externalIds?: SemanticScholarExternalIds | null;
  openAccessPdf?: SemanticScholarOpenAccessPdf | null;
  venue?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  referenceCount?: number | null;
}

interface SemanticScholarBulkSearchResponse {
  total?: number | string | null;
  token?: string | null;
  data?: SemanticScholarBulkPaperRecord[];
}

export type SemanticScholarSourceUrlKind =
  | "doi"
  | "arxiv"
  | "semantic_scholar";

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  venue?: string;
  year?: number;
  publicationDate?: string;
  citationCount: number;
  influentialCitationCount: number;
  referenceCount?: number;
  semanticScholarUrl: string;
  sourceUrl: string;
  sourceUrlKind: SemanticScholarSourceUrlKind;
  landingPageUrl: string;
  pdfUrl?: string;
  extractorUrl: string;
  externalIds: Record<string, string>;
}

export interface SemanticScholarSearchResult {
  total?: number;
  token?: string;
  usedPublicFallback: boolean;
  papers: SemanticScholarPaper[];
}

export async function searchSemanticScholarPapers({
  query,
  apiKey,
  maxResults = 10,
  sort,
  minCitationCount,
  fieldsOfStudy,
  publicationTypes,
  publicationDateOrYear,
  year,
  venue,
  openAccessPdfOnly,
  token,
  fallbackToPublicSearchOnForbidden = false,
  fetchImpl = fetch,
}: {
  query: string;
  apiKey?: string;
  maxResults?: number;
  sort?: string;
  minCitationCount?: number;
  fieldsOfStudy?: string[];
  publicationTypes?: string[];
  publicationDateOrYear?: string;
  year?: string;
  venue?: string[];
  openAccessPdfOnly?: boolean;
  token?: string;
  fallbackToPublicSearchOnForbidden?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SemanticScholarSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("query is required");
  }

  const url = new URL("/graph/v1/paper/search/bulk", SEMANTIC_SCHOLAR_BASE_URL);
  url.searchParams.set("query", trimmedQuery);
  url.searchParams.set("fields", DEFAULT_FIELDS);

  if (sort) {
    url.searchParams.set("sort", sort);
  }

  if (typeof minCitationCount === "number") {
    url.searchParams.set("minCitationCount", String(minCitationCount));
  }

  if (fieldsOfStudy && fieldsOfStudy.length > 0) {
    url.searchParams.set("fieldsOfStudy", fieldsOfStudy.join(","));
  }

  if (publicationTypes && publicationTypes.length > 0) {
    url.searchParams.set("publicationTypes", publicationTypes.join(","));
  }

  if (publicationDateOrYear) {
    url.searchParams.set("publicationDateOrYear", publicationDateOrYear);
  }

  if (year) {
    url.searchParams.set("year", year);
  }

  if (venue && venue.length > 0) {
    url.searchParams.set("venue", venue.join(","));
  }

  if (openAccessPdfOnly) {
    url.searchParams.set("openAccessPdf", "");
  }

  if (token) {
    url.searchParams.set("token", token);
  }

  const { response, usedPublicFallback } = await fetchSemanticScholarBulkSearch({
    url,
    apiKey,
    fallbackToPublicSearchOnForbidden,
    fetchImpl,
  });

  const payload =
    (await response.json()) as SemanticScholarBulkSearchResponse;

  return {
    total: coerceNumber(payload.total),
    token: payload.token ?? undefined,
    usedPublicFallback,
    papers: (payload.data ?? []).slice(0, maxResults).map(normalizePaper),
  };
}

async function fetchSemanticScholarBulkSearch({
  url,
  apiKey,
  fallbackToPublicSearchOnForbidden,
  fetchImpl,
}: {
  url: URL;
  apiKey?: string;
  fallbackToPublicSearchOnForbidden: boolean;
  fetchImpl: typeof fetch;
}) {
  const keyedResponse = await fetchImpl(url.toString(), {
    headers: buildHeaders(apiKey),
  });

  if (
    keyedResponse.status === 403 &&
    apiKey?.trim() &&
    fallbackToPublicSearchOnForbidden
  ) {
    const publicResponse = await fetchImpl(url.toString(), {
      headers: buildHeaders(undefined),
    });

    if (publicResponse.ok) {
      return {
        response: publicResponse,
        usedPublicFallback: true,
      };
    }

    const publicBody = await publicResponse.text();
    throw new Error(
      `Semantic Scholar bulk search failed after public fallback: ${publicResponse.status} ${publicBody}`.trim()
    );
  }

  if (!keyedResponse.ok) {
    const body = await keyedResponse.text();
    throw new Error(
      `Semantic Scholar bulk search failed: ${keyedResponse.status} ${body}`.trim()
    );
  }

  return {
    response: keyedResponse,
    usedPublicFallback: false,
  };
}

function buildHeaders(apiKey?: string) {
  const headers = new Headers({
    Accept: "application/json",
  });

  if (apiKey?.trim()) {
    headers.set("x-api-key", apiKey.trim());
  }

  return headers;
}

function normalizePaper(
  paper: SemanticScholarBulkPaperRecord
): SemanticScholarPaper {
  const semanticScholarUrl = normalizeSemanticScholarUrl(paper);
  const externalIds = normalizeExternalIds(paper.externalIds);
  const doi = normalizeDoi(externalIds.DOI);
  const arxivId = normalizeArxivId(externalIds.ArXiv);
  const pdfUrl =
    normalizeUrl(paper.openAccessPdf?.url) ??
    (arxivId ? buildArxivPdfUrl(arxivId) : undefined);

  const sourceUrl = doi
    ? buildDoiUrl(doi)
    : arxivId
      ? buildArxivAbsUrl(arxivId)
      : semanticScholarUrl;

  const sourceUrlKind: SemanticScholarSourceUrlKind = doi
    ? "doi"
    : arxivId
      ? "arxiv"
      : "semantic_scholar";

  return {
    paperId: paper.paperId,
    title: paper.title?.trim() || "Untitled",
    venue: paper.venue ?? undefined,
    year: typeof paper.year === "number" ? paper.year : undefined,
    publicationDate: paper.publicationDate ?? undefined,
    citationCount:
      typeof paper.citationCount === "number" ? paper.citationCount : 0,
    influentialCitationCount:
      typeof paper.influentialCitationCount === "number"
        ? paper.influentialCitationCount
        : 0,
    referenceCount:
      typeof paper.referenceCount === "number" ? paper.referenceCount : undefined,
    semanticScholarUrl,
    sourceUrl,
    sourceUrlKind,
    landingPageUrl: sourceUrl,
    pdfUrl,
    extractorUrl: pdfUrl ?? sourceUrl,
    externalIds,
  };
}

function normalizeSemanticScholarUrl(
  paper: Pick<SemanticScholarBulkPaperRecord, "paperId" | "url">
) {
  return (
    normalizeUrl(paper.url) ??
    `https://www.semanticscholar.org/paper/${paper.paperId}`
  );
}

function normalizeExternalIds(
  value?: SemanticScholarExternalIds | null
): Record<string, string> {
  const entries = Object.entries(value ?? {})
    .map(([key, rawValue]) => [key, String(rawValue ?? "").trim()] as const)
    .filter(([, rawValue]) => rawValue.length > 0);

  return Object.fromEntries(entries);
}

function normalizeUrl(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDoi(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

function buildDoiUrl(doi: string) {
  return `https://doi.org/${doi}`;
}

function normalizeArxivId(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^arxiv:/i, "");
}

function buildArxivAbsUrl(arxivId: string) {
  return `https://arxiv.org/abs/${arxivId}`;
}

function buildArxivPdfUrl(arxivId: string) {
  return `https://arxiv.org/pdf/${arxivId}.pdf`;
}

function coerceNumber(value?: number | string | null) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
