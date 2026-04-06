// ── Brave Search API Client ─────────────────────────────────────────────────
// Requires API key from https://api-dashboard.search.brave.com
// Free tier: ~1,000 queries/month ($5 credit)

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 10_000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  pageAge?: string;
  hostname?: string;
}

interface BraveApiResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  page_age?: string;
  meta_url?: { hostname?: string };
}

interface BraveApiResponse {
  web?: {
    results?: BraveApiResult[];
  };
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Search the web via Brave Search API. Requires an API key.
 * Returns up to numResults web search results.
 * Returns empty array on any failure.
 */
export async function searchBrave(
  query: string,
  apiKey: string,
  numResults = 10,
): Promise<BraveSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(numResults, 20)),
      text_decorations: "false",
    });

    const response = await fetch(`${BRAVE_API_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const data = (await response.json()) as BraveApiResponse;
    const results = data.web?.results ?? [];

    return results.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      age: r.age,
      pageAge: r.page_age,
      hostname: r.meta_url?.hostname,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
