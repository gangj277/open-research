import { load as loadCheerio } from "cheerio";
import { USER_AGENT } from "@/lib/agent/tools/fetch-url";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

// ── Search ─────────────────────────────────────────────────────────────────

const DDG_URL = "https://html.duckduckgo.com/html/";
const TIMEOUT_MS = 10_000;

/**
 * Search DuckDuckGo via the HTML endpoint (no API key required).
 * Returns up to numResults organic search results.
 * Returns empty array on any failure.
 */
export async function searchDuckDuckGo(
  query: string,
  numResults = 10,
): Promise<DuckDuckGoResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(DDG_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `q=${encodeURIComponent(query)}`,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const html = await response.text();
    const $ = loadCheerio(html);
    const results: DuckDuckGoResult[] = [];

    $(".result").each((_, el) => {
      if (results.length >= numResults) return false;

      const $el = $(el);
      const titleEl = $el.find(".result__a").first();
      const snippetEl = $el.find(".result__snippet").first();

      const title = titleEl.text().trim();
      let url = titleEl.attr("href") ?? "";

      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      if (url.includes("uddg=")) {
        try {
          const parsed = new URL(url, "https://duckduckgo.com");
          url = decodeURIComponent(parsed.searchParams.get("uddg") ?? url);
        } catch {
          // Keep original URL
        }
      }

      const snippet = snippetEl.text().trim();

      if (title && url && url.startsWith("http")) {
        results.push({ title, url, snippet });
      }
    });

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
