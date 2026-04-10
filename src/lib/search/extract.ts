import type { LLMProvider } from "@/lib/llm/provider";
import { getProviderCatalog } from "@/lib/llm/provider-catalog";

// ── Types ──────────────────────────────────────────────────────────────────

export type EvidenceType = "meta-analysis" | "systematic-review" | "experiment" | "observational" | "review" | "opinion" | "dataset" | "other";
export type ExtractionConfidence = "high" | "medium" | "low";

export interface ExtractionResult {
  supports: string[];
  contradicts: string[];
  related: string[];
  summary: string;
  relevanceScore: number;
  evidenceType: EvidenceType;
  methodologyNotes: string;
  sampleInfo: string | null;
  confidence: ExtractionConfidence;
}

export interface ExtractionInput {
  title: string;
  content: string;
  url: string;
  target: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_CONTENT_CHARS = 12_000;

const EXTRACTION_PROMPT = `You are a research extraction system. You receive source text and a research target. Analyze the source through the lens of the target and extract structured findings.

Research target: {TARGET}
Source: "{TITLE}" ({URL})

Rules:
- "supports": Direct evidence, data, or arguments that SUPPORT the target. Quote or precisely paraphrase. Each item = one specific finding.
- "contradicts": Direct evidence, data, or arguments that CONTRADICT or challenge the target. Same precision.
- "related": Relevant context that neither supports nor contradicts — methodology, definitions, related phenomena, frameworks.
- "summary": One paragraph synthesizing what this source contributes to understanding the target.
- "relevanceScore": 0-10. 0 = unrelated. 5 = tangentially relevant. 10 = directly addresses the target.
- "evidenceType": Classify the source — meta-analysis, systematic-review, experiment, observational, review, opinion, dataset, or other.
- "methodologyNotes": One sentence on methodology. Include study design, duration, key methods. Write "N/A" if not applicable (e.g., opinion piece).
- "sampleInfo": Sample size and population if mentioned (e.g., "N=1,234 undergraduate students"). Null if not available.
- "confidence": Your confidence in this extraction — high (clear evidence, unambiguous), medium (evidence present but interpretation uncertain), low (tangential or ambiguous source).
- If clearly unrelated (score < 2), set supports/contradicts/related to empty arrays and evidenceType to "other".
- Maximum 5 items per category. Prefer fewer precise items over many vague ones.
- Include specific numbers, methods, or datasets when available.`;

const EXTRACTION_SCHEMA = {
  name: "source_extraction",
  schema: {
    type: "object" as const,
    properties: {
      supports: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Evidence supporting the target",
      },
      contradicts: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Evidence contradicting the target",
      },
      related: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Related but non-directional findings",
      },
      summary: {
        type: "string" as const,
        description: "One-paragraph synthesis",
      },
      relevanceScore: {
        type: "number" as const,
        description: "0-10 relevance to target",
      },
      evidenceType: {
        type: "string" as const,
        enum: ["meta-analysis", "systematic-review", "experiment", "observational", "review", "opinion", "dataset", "other"],
        description: "Classification of evidence type",
      },
      methodologyNotes: {
        type: "string" as const,
        description: "Brief methodology description or N/A",
      },
      sampleInfo: {
        type: ["string", "null"] as const,
        description: "Sample size and population, or null if unavailable",
      },
      confidence: {
        type: "string" as const,
        enum: ["high", "medium", "low"],
        description: "Extraction confidence level",
      },
    },
    required: ["supports", "contradicts", "related", "summary", "relevanceScore", "evidenceType", "methodologyNotes", "sampleInfo", "confidence"],
    additionalProperties: false,
  },
};

// ── Single Extraction ──────────────────────────────────────────────────────

export async function extractWithTarget(
  input: ExtractionInput,
  provider: LLMProvider,
): Promise<ExtractionResult | null> {
  const truncatedContent = input.content.slice(0, MAX_CONTENT_CHARS);

  const systemPrompt = EXTRACTION_PROMPT
    .replace("{TARGET}", input.target)
    .replace("{TITLE}", input.title)
    .replace("{URL}", input.url);

  try {
    const response = await provider.callLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: truncatedContent },
      ],
      model: getProviderCatalog(provider.kind).backgroundModel,
      temperature: 0,
      maxTokens: 1500,
      jsonSchema: EXTRACTION_SCHEMA,
    });

    const parsed = JSON.parse(response.content) as ExtractionResult;

    // Validate structure
    if (typeof parsed.relevanceScore !== "number") return null;
    if (!Array.isArray(parsed.supports)) return null;

    // Default new fields if LLM omits them (backward safety)
    if (!parsed.evidenceType) parsed.evidenceType = "other";
    if (!parsed.methodologyNotes) parsed.methodologyNotes = "N/A";
    if (parsed.sampleInfo === undefined) parsed.sampleInfo = null;
    if (!parsed.confidence) parsed.confidence = "medium";

    return parsed;
  } catch {
    return null;
  }
}

// ── Batch Extraction ───────────────────────────────────────────────────────

export async function extractBatch(
  inputs: ExtractionInput[],
  provider: LLMProvider,
): Promise<Map<string, ExtractionResult>> {
  const results = await Promise.allSettled(
    inputs.map(async (input) => {
      const result = await extractWithTarget(input, provider);
      return [input.url, result] as const;
    })
  );

  const map = new Map<string, ExtractionResult>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value[1] !== null) {
      map.set(result.value[0], result.value[1]);
    }
  }
  return map;
}

// ── Format Extraction Results ──────────────────────────────────────────────

export function formatExtractionResults(
  sources: Array<{
    title: string;
    url: string;
    provider?: string;
    extraction: ExtractionResult;
    year?: number;
    venue?: string;
    citationCount?: number;
    queryIntent?: string;
  }>
): string {
  if (sources.length === 0) return "No relevant results found for this target.";

  // Sort by relevance
  const sorted = [...sources].sort((a, b) => b.extraction.relevanceScore - a.extraction.relevanceScore);

  const parts: string[] = [`Based on ${sorted.length} source${sorted.length !== 1 ? "s" : ""}:\n`];

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const providerLabel = s.provider ? ` [${s.provider}]` : "";
    const intentLabel = s.queryIntent === "adversarial" ? " [adversarial]" : "";

    // Quality metadata line
    const metaParts: string[] = [];
    if (s.year) metaParts.push(String(s.year));
    if (s.venue) metaParts.push(s.venue);
    if (s.citationCount !== undefined && s.citationCount > 0) metaParts.push(`${s.citationCount} citations`);
    metaParts.push(s.extraction.evidenceType);
    if (s.extraction.sampleInfo) metaParts.push(s.extraction.sampleInfo);
    if (s.extraction.confidence !== "high") metaParts.push(`confidence: ${s.extraction.confidence}`);
    const metaLine = metaParts.length > 0 ? `   ${metaParts.join(" | ")}` : "";

    parts.push(`${i + 1}. "${s.title}"${providerLabel}${intentLabel} (relevance: ${s.extraction.relevanceScore}/10)`);
    parts.push(`   ${s.url}`);
    if (metaLine) parts.push(metaLine);

    if (s.extraction.supports.length > 0) {
      parts.push(`   Supports:`);
      for (const item of s.extraction.supports) {
        parts.push(`   + ${item}`);
      }
    }
    if (s.extraction.contradicts.length > 0) {
      parts.push(`   Contradicts:`);
      for (const item of s.extraction.contradicts) {
        parts.push(`   - ${item}`);
      }
    }
    if (s.extraction.related.length > 0) {
      parts.push(`   Related:`);
      for (const item of s.extraction.related) {
        parts.push(`   ~ ${item}`);
      }
    }
    if (s.extraction.methodologyNotes && s.extraction.methodologyNotes !== "N/A") {
      parts.push(`   Methodology: ${s.extraction.methodologyNotes}`);
    }
    parts.push(`   Summary: ${s.extraction.summary}`);
    parts.push("");
  }

  return parts.join("\n");
}
