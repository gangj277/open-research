import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const standardFontDataUrl =
  path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

export interface PdfExtractResult {
  text: string;
  totalPages: number;
}

export async function extractPdfText(
  filePath: string,
  options?: { startPage?: number; endPage?: number }
): Promise<PdfExtractResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buffer = await fs.readFile(filePath);
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), standardFontDataUrl })
    .promise;
  const totalPages = document.numPages;
  const start = Math.max(1, options?.startPage ?? 1);
  const end = Math.min(totalPages, options?.endPage ?? totalPages);

  const pages: string[] = [];
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(text);
  }

  return { text: pages.join("\n\n"), totalPages };
}

export async function extractPdfTextFromBuffer(
  buffer: Uint8Array,
  options?: { maxPages?: number }
): Promise<PdfExtractResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: buffer, standardFontDataUrl }).promise;
  const totalPages = document.numPages;
  const end = Math.min(totalPages, options?.maxPages ?? 20);

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= end; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(text);
  }

  return { text: pages.join("\n\n"), totalPages };
}
