/** Pure utility functions for URL / ID / string normalization used by scholarly search. */

export function normalizeUrl(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isDoiUrl(value?: string) {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return false;
  }

  try {
    return new URL(normalized).hostname.toLowerCase() === "doi.org";
  } catch {
    return false;
  }
}

export function normalizeDoi(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

export function normalizeArxivId(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^arxiv:/i, "");
}

export function extractArxivIdFromUrl(url?: string) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return undefined;
  }

  const match =
    normalized.match(/\/abs\/([^/?#]+)/i) ??
    normalized.match(/\/pdf\/([^/?#]+)/i);

  return match?.[1];
}

export function normalizeDatePrefix(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 10) : undefined;
}

export function normalizePublicationYear(value?: string) {
  const year = Number.parseInt(value?.slice(0, 4) ?? "", 10);
  return Number.isFinite(year) ? year : undefined;
}

export function normalizePositiveNumber(value?: number) {
  return typeof value === "number" && value > 0 ? value : undefined;
}

export function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function uniqueQueries(values: string[]) {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(trimmed);
  }

  return results;
}

export function isCandidate<T>(value: T | null): value is T {
  return value !== null;
}
