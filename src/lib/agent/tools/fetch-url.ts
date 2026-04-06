import { load as loadCheerio } from "cheerio";

const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Convert HTML to clean readable text using cheerio (proper DOM parsing).
 * Strips scripts, styles, nav, and boilerplate. Preserves heading hierarchy and paragraphs.
 */
export function htmlToText(html: string): string {
  const $ = loadCheerio(html);

  // Remove non-content elements
  $("script, style, noscript, nav, footer, header, aside, iframe, svg").remove();

  // Extract title
  const title = $("title").first().text().trim();

  // Extract main content — prefer <main> or <article>, fall back to <body>
  const mainEl = $("main").length > 0
    ? $("main")
    : $("article").length > 0
      ? $("article")
      : $("body");

  // Build text with structure
  const sections: string[] = [];
  if (title) sections.push(`# ${title}\n`);

  mainEl.find("h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, pre, dd, dt, figcaption").each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase() ?? "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;

    if (tag === "h1") sections.push(`\n# ${text}`);
    else if (tag === "h2") sections.push(`\n## ${text}`);
    else if (tag === "h3") sections.push(`\n### ${text}`);
    else if (tag.startsWith("h")) sections.push(`\n#### ${text}`);
    else if (tag === "li") sections.push(`- ${text}`);
    else if (tag === "blockquote") sections.push(`> ${text}`);
    else if (tag === "pre") sections.push(`\`\`\`\n${text}\n\`\`\``);
    else sections.push(text);
  });

  // Fallback: if structured extraction got nothing, do a simple body text
  if (sections.length <= 1) {
    const bodyText = mainEl.text().replace(/\s+/g, " ").trim();
    if (title) return `# ${title}\n\n${bodyText}`;
    return bodyText;
  }

  return sections.join("\n");
}

/**
 * Fetch a URL and return its content as text.
 * Uses cheerio for proper HTML→text conversion.
 * Reports redirects. Handles JSON, binary, timeouts.
 */
export async function executeFetchUrl(
  args: {
    url: string;
    format?: "text" | "html" | "raw";
    timeout?: number;
  },
  signal?: AbortSignal
): Promise<string> {
  const url = args.url.trim();
  if (!url) return "Error: url is required.";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Error: Invalid URL: ${url}`;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return `Error: Only http and https URLs are supported.`;
  }

  const timeout = Math.min(
    Math.max(args.timeout ?? DEFAULT_TIMEOUT_MS, 5000),
    MAX_TIMEOUT_MS
  );
  const format = args.format ?? "text";

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeout);

  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    let response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,text/plain,*/*" },
      redirect: "follow",
      signal: combinedSignal,
    });

    // Cloudflare challenge retry
    if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
      response = await fetch(url, {
        headers: { "User-Agent": "open-research-cli/0.1", Accept: "text/html,application/json,text/plain,*/*" },
        redirect: "follow",
        signal: combinedSignal,
      });
    }

    if (!response.ok) {
      return `Error: HTTP ${response.status} ${response.statusText}`;
    }

    // Report redirect
    const finalUrl = response.url;
    const redirectNote = finalUrl && finalUrl !== url
      ? `(Redirected to: ${finalUrl})\n\n`
      : "";

    const contentType = response.headers.get("content-type") ?? "";

    // Binary content
    if (
      contentType.includes("image/") ||
      contentType.includes("audio/") ||
      contentType.includes("video/") ||
      contentType.includes("application/octet-stream") ||
      contentType.includes("application/zip")
    ) {
      const length = response.headers.get("content-length");
      return `${redirectNote}Binary content: ${contentType}${length ? ` (${(Number(length) / 1024).toFixed(1)} KB)` : ""}. Use run_command with curl to download.`;
    }

    // Stream-read body with size limit
    const reader = response.body?.getReader();
    if (!reader) return "Error: No response body.";

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.length > MAX_RESPONSE_BYTES) {
        const remaining = MAX_RESPONSE_BYTES - totalBytes;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        totalBytes = MAX_RESPONSE_BYTES;
        truncated = true;
        reader.cancel();
        break;
      }
      chunks.push(value);
      totalBytes += value.length;
    }

    const raw = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
    );

    const truncSuffix = truncated ? "\n\n(Response truncated to 512 KB)" : "";

    // JSON → pretty-print
    if (contentType.includes("application/json")) {
      try {
        const obj = JSON.parse(raw);
        return redirectNote + JSON.stringify(obj, null, 2) + truncSuffix;
      } catch {
        // malformed JSON, fall through
      }
    }

    // HTML → structured text via cheerio, or raw
    if (contentType.includes("text/html")) {
      if (format === "html") {
        return redirectNote + raw + truncSuffix;
      }
      const text = htmlToText(raw);
      return redirectNote + text + truncSuffix;
    }

    // Everything else → raw text
    return redirectNote + raw + truncSuffix;
  } catch (err) {
    if (signal?.aborted) return "Fetch aborted by user.";
    if (err instanceof Error && err.name === "AbortError") {
      return `Fetch timed out after ${(timeout / 1000).toFixed(0)}s.`;
    }
    return `Fetch error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}
