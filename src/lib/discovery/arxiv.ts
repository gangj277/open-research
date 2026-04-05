const ARXIV_API_BASE_URL = "https://export.arxiv.org";

export type ArxivSortBy = "relevance" | "lastUpdatedDate" | "submittedDate";
export type ArxivSortOrder = "ascending" | "descending";

export interface ArxivPaper {
  id: string;
  arxivId: string;
  title: string;
  summary: string;
  published?: string;
  updated?: string;
  authors: string[];
  categories: string[];
  primaryCategory?: string;
  comment?: string;
  journalReference?: string;
  sourceUrl: string;
  landingPageUrl: string;
  pdfUrl?: string;
  extractorUrl: string;
}

export interface ArxivSearchResult {
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  papers: ArxivPaper[];
}

export function buildArxivSearchQuery({
  query,
  categories,
  submittedDateRange,
}: {
  query: string;
  categories?: string[];
  submittedDateRange?: {
    from: string;
    to: string;
  };
}) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("query is required");
  }

  const clauses = [
    `(ti:"${escapeArxivPhrase(trimmedQuery)}" OR abs:"${escapeArxivPhrase(trimmedQuery)}")`,
  ];

  if (categories && categories.length > 0) {
    clauses.push(`(${categories.map((category) => `cat:${category}`).join(" OR ")})`);
  }

  if (submittedDateRange) {
    clauses.push(
      `submittedDate:[${submittedDateRange.from} TO ${submittedDateRange.to}]`
    );
  }

  return clauses.join(" AND ");
}

export async function searchArxivPapers({
  query,
  rawSearchQuery,
  categories,
  submittedDateRange,
  start = 0,
  maxResults = 10,
  sortBy = "relevance",
  sortOrder = "descending",
  fetchImpl = fetch,
}: {
  query?: string;
  rawSearchQuery?: string;
  categories?: string[];
  submittedDateRange?: {
    from: string;
    to: string;
  };
  start?: number;
  maxResults?: number;
  sortBy?: ArxivSortBy;
  sortOrder?: ArxivSortOrder;
  fetchImpl?: typeof fetch;
}): Promise<ArxivSearchResult> {
  const searchQuery = rawSearchQuery?.trim()
    ? rawSearchQuery.trim()
    : buildArxivSearchQuery({
        query: query ?? "",
        categories,
        submittedDateRange,
      });

  const url = new URL("/api/query", ARXIV_API_BASE_URL);
  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("start", String(start));
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", sortBy);
  url.searchParams.set("sortOrder", sortOrder);

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`arXiv search failed: ${response.status}`);
  }

  return parseArxivFeed(await response.text());
}

function parseArxivFeed(xml: string): ArxivSearchResult {
  return {
    totalResults: parseIntegerTag(xml, "opensearch:totalResults"),
    startIndex: parseIntegerTag(xml, "opensearch:startIndex"),
    itemsPerPage: parseIntegerTag(xml, "opensearch:itemsPerPage"),
    papers: extractBlocks(xml, "entry").map(parseArxivEntry),
  };
}

function parseArxivEntry(entryXml: string): ArxivPaper {
  const alternateLink = extractLink(entryXml, {
    rel: "alternate",
    type: "text/html",
  });
  const pdfLink = extractLink(entryXml, {
    rel: "related",
    type: "application/pdf",
  });
  const id = normalizeArxivUrl(extractTagText(entryXml, "id") ?? alternateLink ?? "");
  const sourceUrl = normalizeArxivUrl(alternateLink ?? id);
  const arxivId = extractArxivId(sourceUrl || id);

  return {
    id: sourceUrl || id,
    arxivId,
    title: extractTagText(entryXml, "title") ?? "Untitled",
    summary: extractTagText(entryXml, "summary") ?? "",
    published: extractTagText(entryXml, "published") ?? undefined,
    updated: extractTagText(entryXml, "updated") ?? undefined,
    authors: extractAuthorNames(entryXml),
    categories: extractCategoryTerms(entryXml),
    primaryCategory:
      extractAttribute(entryXml, "arxiv:primary_category", "term") ?? undefined,
    comment: extractTagText(entryXml, "arxiv:comment") ?? undefined,
    journalReference:
      extractTagText(entryXml, "arxiv:journal_ref") ?? undefined,
    sourceUrl,
    landingPageUrl: sourceUrl,
    pdfUrl: normalizeArxivUrl(pdfLink),
    extractorUrl: normalizeArxivUrl(pdfLink ?? sourceUrl),
  };
}

function parseIntegerTag(xml: string, tagName: string) {
  const value = extractTagText(xml, tagName);
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractBlocks(xml: string, tagName: string) {
  const pattern = new RegExp(`<${escapeRegex(tagName)}>([\\s\\S]*?)<\\/${escapeRegex(tagName)}>`, "g");
  return Array.from(xml.matchAll(pattern), (match) => match[1] ?? "");
}

function extractTagText(xml: string, tagName: string) {
  const pattern = new RegExp(
    `<${escapeRegex(tagName)}>([\\s\\S]*?)<\\/${escapeRegex(tagName)}>`,
    "i"
  );
  const match = xml.match(pattern);
  return match ? normalizeXmlText(match[1] ?? "") : undefined;
}

function extractAttribute(xml: string, tagName: string, attributeName: string) {
  const pattern = new RegExp(
    `<${escapeRegex(tagName)}\\b[^>]*\\b${escapeRegex(attributeName)}="([^"]+)"[^>]*/?>`,
    "i"
  );
  const match = xml.match(pattern);
  return match?.[1];
}

function extractAuthorNames(xml: string) {
  return extractBlocks(xml, "author")
    .map((authorXml) => extractTagText(authorXml, "name"))
    .filter((name): name is string => Boolean(name));
}

function extractCategoryTerms(xml: string) {
  const pattern = /<category\b[^>]*\bterm="([^"]+)"[^>]*\/?>/gi;
  return Array.from(xml.matchAll(pattern), (match) => match[1] ?? "");
}

function extractLink(
  xml: string,
  filters: {
    rel?: string;
    type?: string;
    title?: string;
  }
) {
  const linkPattern = /<link\b([^>]*?)\/?>/gi;

  for (const match of xml.matchAll(linkPattern)) {
    const attributes = parseXmlAttributes(match[1] ?? "");
    if (filters.rel && attributes.rel !== filters.rel) continue;
    if (filters.type && attributes.type !== filters.type) continue;
    if (filters.title && attributes.title !== filters.title) continue;
    if (attributes.href) {
      return attributes.href;
    }
  }

  return undefined;
}

function parseXmlAttributes(attributeText: string) {
  const attributes: Record<string, string> = {};
  const attributePattern = /([a-zA-Z_:][\w:.-]*)="([^"]*)"/g;

  for (const match of attributeText.matchAll(attributePattern)) {
    attributes[match[1] ?? ""] = decodeXmlEntities(match[2] ?? "");
  }

  return attributes;
}

function normalizeXmlText(value: string) {
  return decodeXmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeArxivUrl(url?: string) {
  if (!url) {
    return "";
  }

  return url.replace(/^http:\/\//i, "https://");
}

function extractArxivId(url: string) {
  const match = url.match(/\/abs\/([^/?#]+)/i) ?? url.match(/\/pdf\/([^/?#]+)/i);
  return match?.[1] ?? url;
}

function escapeArxivPhrase(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
