import { loadOpenResearchConfig, getSemanticScholarApiKey } from "@/lib/config/store";

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "title,url,year,venue,citationCount,externalIds,abstract";

interface CitationEdge {
  citingPaper?: CitedPaper;
  citedPaper?: CitedPaper;
}

interface CitedPaper {
  paperId: string;
  title?: string;
  url?: string;
  year?: number;
  venue?: string;
  citationCount?: number;
  externalIds?: Record<string, string>;
  abstract?: string;
}

interface TraversalResult {
  title: string;
  year?: number;
  venue?: string;
  citationCount: number;
  url: string;
  doi?: string;
  arxivId?: string;
  abstract?: string;
}

export async function executeTraverseCitations(
  args: { paper_id: string; direction: "references" | "citations"; limit?: number }
): Promise<string> {
  const { paper_id, direction, limit = 10 } = args;

  if (!paper_id) return "Error: paper_id is required.";
  if (direction !== "references" && direction !== "citations") {
    return 'Error: direction must be "references" or "citations".';
  }

  const config = await loadOpenResearchConfig().catch(() => null);
  const apiKey = getSemanticScholarApiKey(config);

  // Resolve the paper ID (supports DOI, arXiv ID, or S2 paper ID)
  let resolvedId = paper_id;
  if (paper_id.startsWith("10.")) {
    resolvedId = `DOI:${paper_id}`;
  } else if (/^\d{4}\.\d{4,5}/.test(paper_id)) {
    resolvedId = `ArXiv:${paper_id}`;
  }

  const endpoint = `${S2_BASE}/paper/${encodeURIComponent(resolvedId)}/${direction}`;
  const url = new URL(endpoint);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("limit", String(Math.min(limit, 50)));

  const headers: Record<string, string> = {
    "Accept": "application/json",
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const response = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      if (response.status === 404) return `Paper not found: ${paper_id}`;
      return `Semantic Scholar API error: ${response.status}`;
    }

    const body = await response.json() as { data?: CitationEdge[] };
    const edges = body.data ?? [];

    // Extract the papers from the edges
    const papers: TraversalResult[] = [];
    for (const edge of edges) {
      const paper = direction === "citations" ? edge.citingPaper : edge.citedPaper;
      if (!paper?.title) continue;

      papers.push({
        title: paper.title,
        year: paper.year ?? undefined,
        venue: paper.venue || undefined,
        citationCount: paper.citationCount ?? 0,
        url: paper.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
        doi: paper.externalIds?.DOI,
        arxivId: paper.externalIds?.ArXiv,
        abstract: paper.abstract?.slice(0, 300),
      });
    }

    // Sort by citation count descending
    papers.sort((a, b) => b.citationCount - a.citationCount);

    if (papers.length === 0) {
      return `No ${direction} found for paper ${paper_id}.`;
    }

    // Format results
    const dirLabel = direction === "citations" ? "Cited by" : "References";
    const lines = [`${dirLabel} (${papers.length} papers, sorted by citation count):\n`];

    for (let i = 0; i < papers.length; i++) {
      const p = papers[i]!;
      const meta: string[] = [];
      if (p.year) meta.push(String(p.year));
      if (p.venue) meta.push(p.venue);
      meta.push(`${p.citationCount} citations`);
      if (p.doi) meta.push(`DOI:${p.doi}`);
      if (p.arxivId) meta.push(`arXiv:${p.arxivId}`);

      lines.push(`${i + 1}. "${p.title}"`);
      lines.push(`   ${meta.join(" | ")}`);
      lines.push(`   ${p.url}`);
      if (p.abstract) {
        lines.push(`   ${p.abstract}${p.abstract.length >= 300 ? "..." : ""}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  } catch (error) {
    return `Error traversing citations: ${error instanceof Error ? error.message : String(error)}`;
  }
}
