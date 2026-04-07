import type { LLMMessage, ReasoningEffort } from "./types";
import type { ToolDefinition } from "@/lib/agent/tools";

// ── Gemini Content Types ───────────────────────────────────────────────────

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: { content: string } } };

export interface GeminiSystemInstruction {
  parts: Array<{ text: string }>;
}

// ── Message Conversion (OpenAI → Gemini) ───────────────────────────────────

export function convertMessagesToGemini(messages: LLMMessage[]): {
  systemInstruction: GeminiSystemInstruction | undefined;
  contents: GeminiContent[];
} {
  const systemParts: string[] = [];
  const rawContents: GeminiContent[] = [];

  // Build a map of tool_call_id → function name for tool result conversion
  const toolCallNames = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCallNames.set(tc.id, tc.function.name);
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages → systemInstruction
      const text = typeof msg.content === "string" ? msg.content : "";
      if (text.trim()) systemParts.push(text);
      continue;
    }

    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : "";
      if (text.trim()) {
        rawContents.push({ role: "user", parts: [{ text }] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];

      // Text content
      const text = typeof msg.content === "string" ? msg.content : "";
      if (text.trim()) {
        parts.push({ text });
      }

      // Tool calls → functionCall parts
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // Keep empty args
          }
          parts.push({
            functionCall: { name: tc.function.name, args },
            thoughtSignature: "skip_thought_signature_validator",
          });
        }
      }

      if (parts.length > 0) {
        rawContents.push({ role: "model", parts });
      }
      continue;
    }

    if (msg.role === "tool") {
      // Tool results → functionResponse (goes under "user" role in Gemini)
      const name = msg.tool_call_id ? toolCallNames.get(msg.tool_call_id) ?? "unknown" : "unknown";
      const content = typeof msg.content === "string" ? msg.content : "";
      rawContents.push({
        role: "user",
        parts: [{ functionResponse: { name, response: { content } } }],
      });
      continue;
    }
  }

  // Merge consecutive same-role contents (Gemini requires strict alternation)
  const merged: GeminiContent[] = [];
  for (const content of rawContents) {
    const last = merged[merged.length - 1];
    if (last && last.role === content.role) {
      last.parts.push(...content.parts);
    } else {
      merged.push({ role: content.role, parts: [...content.parts] });
    }
  }

  return {
    systemInstruction: systemParts.length > 0
      ? { parts: systemParts.map((text) => ({ text })) }
      : undefined,
    contents: merged,
  };
}

// ── Tool Conversion (OpenAI → Gemini) ──────────────────────────────────────

export function convertToolsToGemini(
  tools?: ToolDefinition[],
): { functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> } | undefined {
  if (!tools || tools.length === 0) return undefined;

  return {
    functionDeclarations: tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  };
}

// ── Reasoning Effort Mapping ───────────────────────────────────────────────

export function mapReasoningEffort(
  effort: ReasoningEffort | undefined,
  model: string,
): Record<string, unknown> | undefined {
  if (!effort || effort === "none") return undefined;

  // 3.x models use thinkingLevel
  if (model.includes("gemini-3")) {
    const levelMap: Record<string, string> = {
      low: "THINKING_LEVEL_LOW",
      medium: "THINKING_LEVEL_MEDIUM",
      high: "THINKING_LEVEL_HIGH",
      xhigh: "THINKING_LEVEL_HIGH",
    };
    return {
      thinkingConfig: {
        thinkingLevel: levelMap[effort] ?? "THINKING_LEVEL_MEDIUM",
        includeThoughts: true,
      },
    };
  }

  // 2.5 models use thinkingBudget
  const budgetMap: Record<string, number> = {
    low: 1024,
    medium: 8192,
    high: 16384,
    xhigh: 32768,
  };
  return {
    thinkingConfig: {
      thinkingBudget: budgetMap[effort] ?? 8192,
      includeThoughts: true,
    },
  };
}

// ── JSON Schema Mapping ────────────────────────────────────────────────────

export function mapJsonSchema(
  schema?: { name: string; schema: Record<string, unknown> },
): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  return {
    responseMimeType: "application/json",
    responseSchema: schema.schema,
  };
}
