/**
 * User-configurable search filters for academic paper discovery.
 * All fields are optional — omitted fields mean "no filter" (return everything).
 */
export interface SearchFilterConfig {
  /** Venue/conference/journal names to restrict results to (e.g. ["ACL", "Nature", "NeurIPS"]) */
  venues?: string[];

  /**
   * Publication type filter.
   * Maps to Semantic Scholar publicationTypes and OpenAlex type filter.
   * arXiv doesn't support this natively — results are post-filtered.
   */
  publicationType?: "journal-article" | "conference" | "review" | "preprint" | "all";

  /**
   * Minimum citation count threshold.
   * Providers without citation data (arXiv) will skip this filter.
   */
  minCitationCount?: number;

  /** Restrict to papers published on or after this date (YYYY-MM-DD) */
  dateFrom?: string;

  /** Restrict to papers published on or before this date (YYYY-MM-DD) */
  dateTo?: string;

  /** Only return open access papers with available PDFs */
  openAccessOnly?: boolean;
}

/** Maps our unified publicationType to Semantic Scholar's publicationTypes param */
export function toSemanticScholarPublicationTypes(
  publicationType?: SearchFilterConfig["publicationType"]
): string[] | undefined {
  switch (publicationType) {
    case "journal-article":
      return ["JournalArticle"];
    case "conference":
      return ["Conference"];
    case "review":
      return ["Review"];
    case "preprint":
      // Semantic Scholar doesn't have a "preprint" type — skip
      return undefined;
    case "all":
    case undefined:
      return undefined;
  }
}

/** Maps our unified publicationType to OpenAlex's type filter value */
export function toOpenAlexType(
  publicationType?: SearchFilterConfig["publicationType"]
): string | undefined {
  switch (publicationType) {
    case "journal-article":
      return "article";
    case "conference":
      // OpenAlex doesn't distinguish conference papers from articles —
      // they're all typed as "article". Skip the type filter entirely.
      return undefined;
    case "review":
      return "review";
    case "preprint":
      return "preprint";
    case "all":
    case undefined:
      return undefined;
  }
}

/**
 * Converts a dateFrom/dateTo pair to Semantic Scholar's publicationDateOrYear format.
 * Format: "YYYY-MM-DD:YYYY-MM-DD", with either side optional.
 */
export function toSemanticScholarDateRange(
  dateFrom?: string,
  dateTo?: string
): string | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return `${dateFrom ?? ""}:${dateTo ?? ""}`;
}

/** Returns true if no filters are set (everything is undefined or empty) */
export function isEmptyFilter(config?: SearchFilterConfig): boolean {
  if (!config) return true;
  return (
    (!config.venues || config.venues.length === 0) &&
    (!config.publicationType || config.publicationType === "all") &&
    config.minCitationCount === undefined &&
    !config.dateFrom &&
    !config.dateTo &&
    !config.openAccessOnly
  );
}
