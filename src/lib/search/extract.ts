import type { LLMProvider } from "@/lib/llm/provider";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  supports: string[];
  contradicts: string[];
  related: string[];
  summary: string;
  relevanceScore: number;
}

export interface ExtractionInput {
  title: string;
  content: string;
  url: string;
  target: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_CONTENT_CHARS = 12_000;

const EXTRACTION_PROMPT = `You are a research extraction system. You receive source text and a research target.

Analyze the source through the lens of the target and extract structured findings.

Research target: {TARGET}
Source: "{TITLE}" ({URL})

Rules:
- "supports": Direct evidence, data, or arguments that SUPPORT the target. Quote or precisely paraphrase. Each item = one specific finding.
- "contradicts": Direct evidence, data, or arguments that CONTRADICT or challenge the target. Same precision.
- "related": Relevant context that neither supports nor contradicts — methodology, definitions, related phenomena, frameworks.
- "summary": One paragraph synthesizing what this source contributes to understanding the target.
- "relevanceScore": 0-10. 0 = unrelated. 5 = tangentially relevant. 10 = directly addresses the target.
- If clearly unrelated (score < 2), set supports/contradicts/related to empty arrays.
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
    },
    required: ["supports", "contradicts", "related", "summary", "relevanceScore"],
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
      model: "gpt-5.4-mini",
      temperature: 0,
      maxTokens: 1500,
      jsonSchema: EXTRACTION_SCHEMA,
    });

    const parsed = JSON.parse(response.content) as ExtractionResult;

    // Validate structure
    if (typeof parsed.relevanceScore !== "number") return null;
    if (!Array.isArray(parsed.supports)) return null;

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
  }>
): string {
  if (sources.length === 0) return "No relevant results found for this target.";

  // Sort by relevance
  const sorted = [...sources].sort((a, b) => b.extraction.relevanceScore - a.extraction.relevanceScore);

  const parts: string[] = [`Based on ${sorted.length} source${sorted.length !== 1 ? "s" : ""}:\n`];

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const providerLabel = s.provider ? ` [${s.provider}]` : "";
    parts.push(`${i + 1}. "${s.title}"${providerLabel} (relevance: ${s.extraction.relevanceScore}/10)`);
    parts.push(`   ${s.url}`);

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
    parts.push(`   Summary: ${s.extraction.summary}`);
    parts.push("");
  }

  return parts.join("\n");
}
