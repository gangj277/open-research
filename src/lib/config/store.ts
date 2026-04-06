import { z } from "zod";
import { getOpenResearchConfigFile, type PathOptions } from "@/lib/fs/paths";
import { readJsonFile, writeJsonFile } from "@/lib/fs/json";

export const themeValues = ["dark", "light"] as const;
export type Theme = (typeof themeValues)[number];

export const openResearchConfigSchema = z.object({
  version: z.literal(1),
  defaults: z.object({
    model: z.string().min(1),
    reasoningEffort: z.enum(["low", "medium", "high"]),
    editPolicy: z.literal("mixed"),
  }),
  theme: z.enum(themeValues).default("dark"),
  lastWorkspace: z.string().nullable(),
  apiKeys: z.object({
    semanticScholar: z.string().optional(),
    openAlex: z.string().optional(),
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
  lastWorkspace: null,
  apiKeys: {},
};

/** Get the Semantic Scholar API key from config or environment */
export function getSemanticScholarApiKey(config?: OpenResearchConfig | null): string | undefined {
  return config?.apiKeys?.semanticScholar || process.env.SEMANTIC_SCHOLAR_API_KEY;
}

/** Get the OpenAlex API key from config or environment */
export function getOpenAlexApiKey(config?: OpenResearchConfig | null): string | undefined {
  return config?.apiKeys?.openAlex || process.env.OPENALEX_API_KEY;
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
