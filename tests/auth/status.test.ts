import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getAuthStatus } from "@/lib/auth/status";
import { getOpenResearchConfigFile } from "@/lib/fs/paths";

const tempDirs: string[] = [];
const originalOpenAIKey = process.env.OPENAI_API_KEY;

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-auth-status-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (originalOpenAIKey) {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("auth status", () => {
  test("reports connected when OPENAI_API_KEY is configured", async () => {
    const homeDir = await makeTempDir();
    process.env.OPENAI_API_KEY = "sk-env-key";

    const status = await getAuthStatus({ homeDir });

    expect(status.connected).toBe(true);
  });

  test("reports connected when provider-scoped config api key is configured", async () => {
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

    const status = await getAuthStatus({ homeDir });

    expect(status.connected).toBe(true);
  });
});
