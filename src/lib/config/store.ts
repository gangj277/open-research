import { z } from "zod";
import { getOpenResearchConfigFile, type PathOptions } from "@/lib/fs/paths";
import { readJsonFile, writeJsonFile } from "@/lib/fs/json";

export const themeValues = ["dark", "light"] as const;
export type Theme = (typeof themeValues)[number];

export const providerValues = ["openai", "gemini"] as const;
export type ActiveProvider = (typeof providerValues)[number];

const openAIProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
}).optional();

const geminiProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
}).optional();

export const openResearchConfigSchema = z.object({
  version: z.literal(1),
  defaults: z.object({
    model: z.string().min(1),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
    editPolicy: z.literal("mixed"),
  }),
  theme: z.enum(themeValues).default("dark"),
  activeProvider: z.enum(providerValues).default("openai"),
  lastWorkspace: z.string().nullable(),
  providers: z.object({
    openai: openAIProviderConfigSchema,
    gemini: geminiProviderConfigSchema,
  }).optional(),
  apiKeys: z.object({
    openai: z.string().optional(),
    semanticScholar: z.string().optional(),
    openAlex: z.string().optional(),
    brave: z.string().optional(),
    gemini: z.string().optional(),
  }).optional(),
});

export type OpenResearchConfig = z.infer<typeof openResearchConfigSchema>;

export const DEFAULT_OPEN_RESEARCH_CONFIG: OpenResearchConfig = {
  version: 1,
  defaults: {
    model: "gpt-5.4",
    reasoningEffort: "medium",
    editPolicy: "mixed",
  },
  theme: "dark",
  activeProvider: "openai",
  lastWorkspace: null,
  providers: {
    openai: {},
    gemini: {},
  },
  apiKeys: {},
};

/** Get the configured OpenAI API key from provider-scoped config or legacy apiKeys */
export function getConfiguredOpenAIApiKey(
  config?: OpenResearchConfig | null
): string | undefined {
  return config?.providers?.openai?.apiKey || config?.apiKeys?.openai;
}

/** Get the Semantic Scholar API key from config or environment */
export function getSemanticScholarApiKey(config?: OpenResearchConfig | null): string | undefined {
  return config?.apiKeys?.semanticScholar || process.env.SEMANTIC_SCHOLAR_API_KEY;
}

/** Get the OpenAlex API key from config or environment */
export function getOpenAlexApiKey(config?: OpenResearchConfig | null): string | undefined {
  return config?.apiKeys?.openAlex || process.env.OPENALEX_API_KEY;
}

/** Get the Brave Search API key from config or environment */
export function getBraveApiKey(config?: OpenResearchConfig | null): string | undefined {
  return config?.apiKeys?.brave || process.env.BRAVE_API_KEY;
}

/** Get the Gemini API key from config or environment */
export function getConfiguredGeminiApiKey(config?: OpenResearchConfig | null): string | undefined {
  return config?.providers?.gemini?.apiKey || config?.apiKeys?.gemini || process.env.GEMINI_API_KEY;
}

export async function loadOpenResearchConfig(
  options?: PathOptions
): Promise<OpenResearchConfig | null> {
  const configFile = getOpenResearchConfigFile(options);
  const config = await readJsonFile<unknown | null>(configFile, null);
  if (!config) {
    return null;
  }
  return openResearchConfigSchema.parse(config);
}

export async function saveOpenResearchConfig(
  config: OpenResearchConfig,
  options?: PathOptions
): Promise<void> {
  await writeJsonFile(getOpenResearchConfigFile(options), config);
}

export async function ensureOpenResearchConfig(
  options?: PathOptions
): Promise<OpenResearchConfig> {
  const existing = await loadOpenResearchConfig(options);
  if (existing) {
    return existing;
  }

  await writeJsonFile(getOpenResearchConfigFile(options), DEFAULT_OPEN_RESEARCH_CONFIG);
  return DEFAULT_OPEN_RESEARCH_CONFIG;
}
