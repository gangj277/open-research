/** Provider-specific normalization: OpenAlex, Semantic Scholar, arXiv → NormalizedCandidate. */

import type { OpenAlexWork } from "@/lib/discovery/openalex";
import {
  buildPaperQualityMeta,
  type PaperQualityMeta,
} from "@/lib/discovery/paper-quality";
import type { SemanticScholarPaper } from "@/lib/discovery/semantic-scholar";
import type { ArxivPaper } from "@/lib/discovery/arxiv";
import type { ScholarlyProvider, ScholarlyDiscoveredSource } from "./scholarly-search";
import {
  normalizeUrl,
  isDoiUrl,
  normalizeDoi,
  normalizeArxivId,
  extractArxivIdFromUrl,
  normalizeDatePrefix,
  normalizePublicationYear,
  normalizePositiveNumber,
} from "./scholarly-utils";

export interface NormalizedCandidate extends ScholarlyDiscoveredSource {
  dedupeKey: string;
  openAlexId?: string;
  semanticScholarPaperId?: string;
  publicationYear?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  openAccess?: boolean;
  preprint?: boolean;
  /** Index of the search query that produced this candidate (for balanced selection). */
  queryIndex: number;
}

export function normalizeOpenAlexWork(work: OpenAlexWork): NormalizedCandidate | null {
  const doi = normalizeDoi(work.doi);
  const landingPageUrl = normalizeUrl(work.landingPageUrl);
  const pdfUrl = normalizeUrl(work.pdfUrl);
  const sourceUrl =
    (landingPageUrl && !isDoiUrl(landingPageUrl) ? landingPageUrl : undefined) ??
    pdfUrl;

  if (!sourceUrl && !pdfUrl) {
    return null;
  }

  return {
    title: work.title,
    url: sourceUrl ?? pdfUrl ?? "",
    pdfUrl,
    publishedDate: work.publicationDate,
    author: undefined,
    provider: "openalex",
    providers: ["openalex"],
    doi,
    arxivId: undefined,
    citationCount: work.citedByCount,
    venue: work.source,
    openAlexId: work.id,
    publicationYear: work.publicationYear,
    influentialCitationCount: undefined,
    referenceCount: undefined,
    openAccess: Boolean(pdfUrl),
    preprint: false,
    queryIndex: 0,
    dedupeKey: buildDedupeKey({
      doi,
      url: sourceUrl,
      title: work.title,
      publishedDate: work.publicationDate,
    }),
  };
}

export function normalizeSemanticScholarPaper(
  paper: SemanticScholarPaper
): NormalizedCandidate | null {
  const doi = normalizeDoi(paper.externalIds.DOI);
  const arxivId =
    normalizeArxivId(paper.externalIds.ArXiv) ??
    (paper.sourceUrlKind === "arxiv" ? extractArxivIdFromUrl(paper.sourceUrl) : undefined);
  const pdfUrl = normalizeUrl(paper.pdfUrl);
  const sourceUrl = arxivId
    ? normalizeUrl(paper.sourceUrl) ?? normalizeUrl(paper.semanticScholarUrl)
    : normalizeUrl(paper.semanticScholarUrl);

  if (paper.sourceUrlKind === "semantic_scholar" && !pdfUrl) {
    return null;
  }

  if (!sourceUrl && !pdfUrl) {
    return null;
  }

  return {
    title: paper.title,
    url: sourceUrl ?? pdfUrl ?? "",
    pdfUrl,
    publishedDate: paper.publicationDate,
    author: undefined,
    provider: "semantic-scholar",
    providers: ["semantic-scholar"],
    doi,
    arxivId,
    citationCount: paper.citationCount,
    venue: paper.venue,
    semanticScholarPaperId: paper.paperId,
    publicationYear: paper.year,
    influentialCitationCount: normalizePositiveNumber(paper.influentialCitationCount),
    referenceCount: normalizePositiveNumber(paper.referenceCount),
    openAccess: Boolean(pdfUrl),
    preprint: paper.sourceUrlKind === "arxiv",
    queryIndex: 0,
    dedupeKey: buildDedupeKey({
      doi,
      arxivId,
      url: sourceUrl,
      title: paper.title,
      publishedDate: paper.publicationDate,
    }),
  };
}

export function normalizeArxivPaper(paper: ArxivPaper): NormalizedCandidate | null {
  const sourceUrl = normalizeUrl(paper.sourceUrl);
  const pdfUrl = normalizeUrl(paper.pdfUrl);

  if (!sourceUrl && !pdfUrl) {
    return null;
  }

  return {
    title: paper.title,
    url: sourceUrl ?? pdfUrl ?? "",
    pdfUrl,
    abstract: paper.summary?.trim() || undefined,
    publishedDate: normalizeDatePrefix(paper.published),
    author: paper.authors[0],
    provider: "arxiv",
    providers: ["arxiv"],
    doi: undefined,
    arxivId: normalizeArxivId(paper.arxivId),
    citationCount: undefined,
    venue: undefined,
    openAlexId: undefined,
    semanticScholarPaperId: undefined,
    publicationYear: normalizePublicationYear(paper.published),
    influentialCitationCount: undefined,
    referenceCount: undefined,
    openAccess: Boolean(pdfUrl),
    preprint: true,
    queryIndex: 0,
    dedupeKey: buildDedupeKey({
      arxivId: paper.arxivId,
      url: sourceUrl,
      title: paper.title,
      publishedDate: paper.published,
    }),
  };
}

export function stripInternalFields({
  dedupeKey,
  openAlexId,
  semanticScholarPaperId,
  publicationYear,
  influentialCitationCount,
  referenceCount,
  openAccess,
  preprint,
  queryIndex,
  ...source
}: NormalizedCandidate): ScholarlyDiscoveredSource {
  void dedupeKey;
  void queryIndex;
  return {
    ...source,
    paperQuality: buildPaperQualityMeta({
      doi: source.doi,
      openAlexId,
      semanticScholarPaperId,
      arxivId: source.arxivId,
      year: publicationYear,
      date: source.publishedDate,
      venue: source.venue,
      citationCount: source.citationCount,
      influentialCitationCount,
      referenceCount,
      providerCount: source.providers.length,
      openAccess,
      preprint,
    }),
  };
}

function buildDedupeKey({
  doi,
  arxivId,
  url,
  title,
  publishedDate,
}: {
  doi?: string;
  arxivId?: string;
  url?: string;
  title: string;
  publishedDate?: string;
}) {
  if (doi) {
    return `doi:${doi}`;
  }

  if (arxivId) {
    return `arxiv:${arxivId}`;
  }

  const normalizedUrl = normalizeUrlForKey(url);
  if (normalizedUrl) {
    return `url:${normalizedUrl}`;
  }

  const year = publishedDate?.slice(0, 4) ?? "";
  return `title:${normalizeTitle(title)}:${year}`;
}

function normalizeUrlForKey(url?: string) {
  const normalized = normalizeUrl(url);
  return normalized?.replace(/\/+$/, "");
}

// Re-import locally used helpers
import { normalizeTitle } from "./scholarly-utils";
