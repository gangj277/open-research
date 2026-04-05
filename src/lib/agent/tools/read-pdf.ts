import path from "node:path";
import fs from "node:fs/promises";
import { extractPdfText } from "@/lib/fs/pdf";

const MAX_OUTPUT_BYTES = 50_000;

function parsePages(pages: string): { start: number; end: number } | null {
  const range = pages.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return { start: Number(range[1]), end: Number(range[2]) };
  const single = pages.match(/^(\d+)$/);
  if (single) return { start: Number(single[1]), end: Number(single[1]) };
  return null;
}

export async function executeReadPdf(
  args: { file_path: string; pages?: string },
): Promise<string> {
  const resolved = path.resolve(args.file_path);

  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) {
    return `Error: file not found: ${resolved}`;
  }

  const pageRange = args.pages ? parsePages(args.pages) : null;
  if (args.pages && !pageRange) {
    return `Error: invalid pages format "${args.pages}". Use "3" or "1-5".`;
  }

  try {
    const result = await extractPdfText(resolved, {
      startPage: pageRange?.start,
      endPage: pageRange?.end,
    });

    const header = pageRange
      ? `PDF: ${resolved} (pages ${pageRange.start}-${pageRange.end} of ${result.totalPages})`
      : `PDF: ${resolved} (${result.totalPages} pages)`;

    let text = result.text;
    if (Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES) {
      text = text.slice(0, MAX_OUTPUT_BYTES) + "\n\n[truncated — use pages parameter to read specific pages]";
    }

    return `${header}\n\n${text}`;
  } catch (error) {
    return `Error reading PDF: ${error instanceof Error ? error.message : String(error)}`;
  }
}
