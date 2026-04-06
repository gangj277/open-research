import { htmlToText, USER_AGENT } from "@/lib/agent/tools/fetch-url";
import { extractPdfTextFromBuffer } from "@/lib/fs/pdf";

// ── Types ──────────────────────────────────────────────────────────────────

export interface FetchedContent {
  text: string;
  contentType: "pdf" | "html" | "text";
  url: string;
  truncated: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const PDF_MAX_PAGES = 5; // Abstract + intro + results
const MIN_USEFUL_TEXT = 100; // Below this = likely paywall/CAPTCHA

// ── Content Type Detection ─────────────────────────────────────────────────

function detectPdf(contentType: string, url: string): boolean {
  if (contentType.includes("application/pdf")) return true;
  if (contentType.includes("text/html")) return false;
  if (contentType.includes("text/")) return false;
  // Ambiguous content-type — check URL pattern
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function isPdfMagicBytes(buffer: Uint8Array): boolean {
  if (buffer.length < 5) return false;
  return String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3], buffer[4]) === "%PDF-";
}

// ── PDF Parsing ────────────────────────────────────────────────────────────

async function parsePdfResponse(response: Response, url: string): Promise<FetchedContent | null> {
  let buffer: Uint8Array;
  try {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PDF_BYTES) return null;
    buffer = new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }

  // Magic bytes check — paywall pages sometimes serve HTML with PDF content-type
  if (!isPdfMagicBytes(buffer)) {
    const text = new TextDecoder().decode(buffer);
    const parsed = htmlToText(text);
    if (parsed.length < MIN_USEFUL_TEXT) return null;
    return { text: parsed, contentType: "html", url: response.url, truncated: false };
  }

  try {
    const result = await extractPdfTextFromBuffer(buffer, { maxPages: PDF_MAX_PAGES });
    if (result.text.length < MIN_USEFUL_TEXT) return null;
    return {
      text: result.text,
      contentType: "pdf",
      url: response.url,
      truncated: result.totalPages > PDF_MAX_PAGES,
    };
  } catch {
    return null; // Corrupted PDF
  }
}

// ── HTML Parsing ───────────────────────────────────────────────────────────

async function parseHtmlResponse(response: Response, url: string): Promise<FetchedContent | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.length > MAX_HTML_BYTES) {
        chunks.push(value.subarray(0, MAX_HTML_BYTES - totalBytes));
        truncated = true;
        reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      totalBytes += value.length;
    }
  } catch {
    if (totalBytes === 0) return null;
  }

  const html = new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
  );
  const text = htmlToText(html);

  if (text.length < MIN_USEFUL_TEXT) return null; // Paywall / CAPTCHA

  return { text, contentType: "html", url: response.url, truncated };
}

// ── Main Fetcher ───────────────────────────────────────────────────────────

/**
 * Fetch a URL and extract its text content. Handles PDFs and HTML pages
 * with smart content-type detection (header → URL pattern → magic bytes).
 *
 * Returns null on any failure — the caller should skip failed fetches.
 */
export async function fetchAndParseContent(url: string): Promise<FetchedContent | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/pdf,application/xhtml+xml,*/*",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";

    // Skip binary content that isn't PDF
    if (
      contentType.includes("image/") ||
      contentType.includes("audio/") ||
      contentType.includes("video/") ||
      contentType.includes("application/zip")
    ) {
      return null;
    }

    if (detectPdf(contentType, url)) {
      return await parsePdfResponse(response, url);
    }

    return await parseHtmlResponse(response, url);
  } catch {
    return null; // Timeout, network error, abort
  } finally {
    clearTimeout(timer);
  }
}
