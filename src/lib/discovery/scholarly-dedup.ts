/** Deduplication, ranking, and balanced round-robin selection for scholarly candidates. */

import type { ScholarlyDiscoveredSource } from "./scholarly-search";
import type { NormalizedCandidate } from "./scholarly-normalize";

/**
 * Merge duplicates across providers/queries, then select results using
 * **balanced round-robin** so every query gets fair representation.
 *
 * Strategy:
 * 1. Deduplicate by dedupeKey (DOI / arXiv ID / URL / title+year).
 *    When a paper appears from multiple queries, it belongs to the
 *    *lowest* queryIndex (the most "primary" query that found it).
 * 2. Group deduplicated candidates by queryIndex, sort each group by quality.
 * 3. Round-robin: take the best remaining paper from each query in turn
 *    until we hit numResults. This guarantees every query contributes at
 *    least floor(numResults / numQueries) papers (if it has that many).
 * 4. If a query's bucket is exhausted, skip it and continue round-robin
 *    with the remaining queries.
 */
export function mergeAndRankCandidates(
  candidates: NormalizedCandidate[],
  numResults: number,
  numQueries: number
) {
  // --- Phase 1: Deduplicate, keeping the lowest queryIndex as "owner" ---
  const merged = new Map<string, NormalizedCandidate>();
  /** Track ALL query indices that found each paper (for multi-query bonus). */
  const queryIndicesMap = new Map<string, Set<number>>();

  for (const candidate of candidates) {
    const existing = merged.get(candidate.dedupeKey);

    if (!existing) {
      merged.set(candidate.dedupeKey, {
        ...candidate,
        providers: [...candidate.providers],
      });
      queryIndicesMap.set(candidate.dedupeKey, new Set([candidate.queryIndex]));
      continue;
    }

    // Track that this query also found the paper
    queryIndicesMap.get(candidate.dedupeKey)!.add(candidate.queryIndex);

    // Keep the lowest queryIndex as the canonical owner
    if (candidate.queryIndex < existing.queryIndex) {
      existing.queryIndex = candidate.queryIndex;
    }

    // Merge metadata as before
    existing.pdfUrl = existing.pdfUrl ?? candidate.pdfUrl;
    existing.url = existing.url || candidate.url;
    existing.publishedDate = existing.publishedDate ?? candidate.publishedDate;
    existing.author = existing.author ?? candidate.author;
    existing.doi = existing.doi ?? candidate.doi;
    existing.arxivId = existing.arxivId ?? candidate.arxivId;
    existing.citationCount = mergeMaxNumber(
      existing.citationCount,
      candidate.citationCount
    );
    existing.venue = existing.venue ?? candidate.venue;
    existing.openAlexId = existing.openAlexId ?? candidate.openAlexId;
    existing.semanticScholarPaperId =
      existing.semanticScholarPaperId ?? candidate.semanticScholarPaperId;
    existing.publicationYear = existing.publicationYear ?? candidate.publicationYear;
    existing.influentialCitationCount = mergeMaxNumber(
      existing.influentialCitationCount,
      candidate.influentialCitationCount
    );
    existing.referenceCount = mergeMaxNumber(
      existing.referenceCount,
      candidate.referenceCount
    );
    existing.openAccess = Boolean(existing.openAccess || candidate.openAccess);
    existing.preprint = Boolean(existing.preprint || candidate.preprint);

    if (!existing.providers.includes(candidate.provider)) {
      existing.providers.push(candidate.provider);
    }
  }

  // --- Phase 2: Group by queryIndex, sort each group by quality ---
  const buckets = new Map<number, NormalizedCandidate[]>();
  for (let i = 0; i < numQueries; i++) {
    buckets.set(i, []);
  }

  for (const paper of merged.values()) {
    const bucket = buckets.get(paper.queryIndex);
    if (bucket) {
      bucket.push(paper);
    } else {
      // Safety: if queryIndex is somehow out of range, put in bucket 0
      buckets.get(0)!.push(paper);
    }
  }

  for (const bucket of buckets.values()) {
    bucket.sort(compareCandidates);
  }

  // --- Phase 3: Round-robin selection ---
  const selected: NormalizedCandidate[] = [];
  const selectedKeys = new Set<string>();
  const bucketPointers = new Map<number, number>();
  for (let i = 0; i < numQueries; i++) {
    bucketPointers.set(i, 0);
  }

  // Keep cycling through queries until we have enough or all buckets are exhausted
  let activeQueries = numQueries;
  while (selected.length < numResults && activeQueries > 0) {
    activeQueries = 0;
    for (let qi = 0; qi < numQueries; qi++) {
      if (selected.length >= numResults) break;

      const bucket = buckets.get(qi)!;
      let ptr = bucketPointers.get(qi)!;

      // Skip already-selected papers (can happen if a paper was assigned to
      // a lower queryIndex but also exists in this bucket from dedup)
      while (ptr < bucket.length && selectedKeys.has(bucket[ptr].dedupeKey)) {
        ptr++;
      }

      if (ptr < bucket.length) {
        selected.push(bucket[ptr]);
        selectedKeys.add(bucket[ptr].dedupeKey);
        bucketPointers.set(qi, ptr + 1);
        activeQueries++;
      }
    }
  }

  return selected;
}

export function compareCandidates(
  left: ScholarlyDiscoveredSource,
  right: ScholarlyDiscoveredSource
) {
  if (Boolean(left.pdfUrl) !== Boolean(right.pdfUrl)) {
    return left.pdfUrl ? -1 : 1;
  }

  if (left.providers.length !== right.providers.length) {
    return right.providers.length - left.providers.length;
  }

  if ((left.citationCount ?? 0) !== (right.citationCount ?? 0)) {
    return (right.citationCount ?? 0) - (left.citationCount ?? 0);
  }

  const leftDate = left.publishedDate ?? "";
  const rightDate = right.publishedDate ?? "";
  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }

  return left.title.localeCompare(right.title);
}

function mergeMaxNumber(left?: number, right?: number) {
  if (typeof left === "number" && typeof right === "number") {
    return Math.max(left, right);
  }

  return typeof left === "number" ? left : right;
}
