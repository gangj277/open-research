import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_OPEN_RESEARCH_CONFIG,
  ensureOpenResearchConfig,
  loadOpenResearchConfig,
} from "@/lib/config/store";
import { getOpenResearchConfigFile } from "@/lib/fs/paths";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("open research config", () => {
  test("ensureOpenResearchConfig creates the default config file and loads it", async () => {
    const homeDir = await makeTempDir();

    const created = await ensureOpenResearchConfig({ homeDir });
    const configFile = getOpenResearchConfigFile({ homeDir });
    const loaded = await loadOpenResearchConfig({ homeDir });

    await expect(fs.stat(configFile).then((value) => value.isFile())).resolves.toBe(true);
    expect(created).toEqual(DEFAULT_OPEN_RESEARCH_CONFIG);
    expect(loaded).toEqual(DEFAULT_OPEN_RESEARCH_CONFIG);
  });

  test("loadOpenResearchConfig preserves provider-scoped OpenAI config", async () => {
    const homeDir = await makeTempDir();
    const configFile = getOpenResearchConfigFile({ homeDir });

    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(
      configFile,
      JSON.stringify({
        version: 1,
        defaults: {
          model: "gpt-5.4",
          reasoningEffort: "medium",
          editPolicy: "mixed",
        },
        theme: "dark",
        lastWorkspace: null,
        providers: {
          openai: {
            apiKey: "sk-provider-config",
          },
        },
        apiKeys: {},
      }),
      "utf8"
    );

    const loaded = await loadOpenResearchConfig({ homeDir });

    expect(loaded?.providers?.openai?.apiKey).toBe("sk-provider-config");
  });
});
