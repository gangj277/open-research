import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createProviderFromStoredAuth } from "@/lib/llm/provider-factory";
import { getOpenResearchConfigFile } from "@/lib/fs/paths";

const tempDirs: string[] = [];
const originalOpenAIKey = process.env.OPENAI_API_KEY;

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-provider-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
});

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

describe("provider factory", () => {
  test("uses providers.openai.apiKey from config when present", async () => {
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

    const provider = await createProviderFromStoredAuth({ homeDir });

    expect(provider.kind).toBe("openai_api_key");
  });

  test("prefers providers.openai.apiKey over legacy apiKeys.openai", async () => {
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
        apiKeys: {
          openai: "sk-legacy-config",
        },
      }),
      "utf8"
    );

    const provider = await createProviderFromStoredAuth({ homeDir });

    expect(provider.kind).toBe("openai_api_key");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "gpt-5.4",
            choices: [{ message: { content: "ok" } }],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    await provider.callLLM({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-5.4",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer sk-provider-config",
      }),
    });

    fetchSpy.mockRestore();
  });
});
