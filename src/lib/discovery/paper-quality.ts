export interface PaperQualityMeta {
  ids?: {
    doi?: string;
    openAlexId?: string;
    semanticScholarPaperId?: string;
    arxivId?: string;
  };
  publication?: {
    year?: number;
    date?: string;
    venue?: string;
  };
  metrics?: {
    citationCount?: number;
    influentialCitationCount?: number;
    referenceCount?: number;
    providerCount?: number;
  };
  flags?: {
    openAccess?: boolean;
    preprint?: boolean;
  };
  hints?: {
    signalScore?: number;
    labels?: string[];
  };
}

export function buildPaperQualityMeta({
  doi,
  openAlexId,
  semanticScholarPaperId,
  arxivId,
  year,
  date,
  venue,
  citationCount,
  influentialCitationCount,
  referenceCount,
  providerCount,
  openAccess,
  preprint,
}: {
  doi?: string;
  openAlexId?: string;
  semanticScholarPaperId?: string;
  arxivId?: string;
  year?: number;
  date?: string;
  venue?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  providerCount?: number;
  openAccess?: boolean;
  preprint?: boolean;
}): PaperQualityMeta | undefined {
  const ids = compactObject({
    doi,
    openAlexId,
    semanticScholarPaperId,
    arxivId,
  });
  const publication = compactObject({
    year,
    date,
    venue,
  });
  const metrics = compactObject({
    citationCount,
    influentialCitationCount,
    referenceCount,
    providerCount,
  });
  const flags = compactObject({
    openAccess,
    preprint,
  });

  const labels: string[] = [];
  if ((citationCount ?? 0) >= 100) {
    labels.push("Highly cited");
  }
  if ((influentialCitationCount ?? 0) >= 10) {
    labels.push("Influential");
  }
  if (openAccess) {
    labels.push("Open access");
  }
  if (preprint) {
    labels.push("Preprint");
  }
  if ((providerCount ?? 0) >= 2) {
    labels.push("Cross-indexed");
  }

  const signalScore = computeSignalScore({
    citationCount,
    influentialCitationCount,
    providerCount,
    openAccess,
    preprint,
  });
  const hints = compactObject({
    signalScore,
    labels: labels.length > 0 ? labels : undefined,
  });

  const meta = compactObject({
    ids,
    publication,
    metrics,
    flags,
    hints,
  }) as PaperQualityMeta;

  return Object.keys(meta).length > 0 ? meta : undefined;
}

export function formatPaperQualitySummary(paperQuality?: PaperQualityMeta) {
  const metrics = paperQuality?.metrics;
  const hints = paperQuality?.hints?.labels ?? [];
  const parts: string[] = [];

  if (typeof metrics?.citationCount === "number") {
    parts.push(`${metrics.citationCount} citations`);
  }
  if (typeof metrics?.influentialCitationCount === "number") {
    parts.push(`${metrics.influentialCitationCount} influential`);
  }
  if (hints.length > 0) {
    parts.push(hints.join(", "));
  }

  return parts.join(" · ");
}

function computeSignalScore({
  citationCount,
  influentialCitationCount,
  providerCount,
  openAccess,
  preprint,
}: {
  citationCount?: number;
  influentialCitationCount?: number;
  providerCount?: number;
  openAccess?: boolean;
  preprint?: boolean;
}) {
  let score = 0;

  if ((citationCount ?? 0) >= 100) {
    score += 50;
  } else if ((citationCount ?? 0) >= 25) {
    score += 25;
  } else if ((citationCount ?? 0) > 0) {
    score += 10;
  }

  if ((influentialCitationCount ?? 0) >= 10) {
    score += 20;
  } else if ((influentialCitationCount ?? 0) > 0) {
    score += 10;
  }

  if ((providerCount ?? 0) >= 2) {
    score += 10;
  }
  if (openAccess) {
    score += 10;
  }
  if (preprint) {
    score += 5;
  }

  return score > 0 ? Math.min(score, 100) : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
  };
}
