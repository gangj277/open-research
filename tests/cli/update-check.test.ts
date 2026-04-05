import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const tempDirs: string[] = [];

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_NPM_PACKAGE_VERSION = process.env.npm_package_version;
const ORIGINAL_OPEN_RESEARCH_PACKAGE_VERSION = process.env.OPEN_RESEARCH_PACKAGE_VERSION;

async function makeTempHomeDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-update-check-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();

  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;

  if (ORIGINAL_NPM_PACKAGE_VERSION === undefined) delete process.env.npm_package_version;
  else process.env.npm_package_version = ORIGINAL_NPM_PACKAGE_VERSION;

  if (ORIGINAL_OPEN_RESEARCH_PACKAGE_VERSION === undefined) {
    delete process.env.OPEN_RESEARCH_PACKAGE_VERSION;
  } else {
    process.env.OPEN_RESEARCH_PACKAGE_VERSION = ORIGINAL_OPEN_RESEARCH_PACKAGE_VERSION;
  }

  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("checkForUpdate", () => {
  test("ignores a cached result from a different installed version and refreshes it", async () => {
    const homeDir = await makeTempHomeDir();
    const stateFile = path.join(homeDir, ".open-research", "update-check.json");

    process.env.HOME = homeDir;
    process.env.OPEN_RESEARCH_PACKAGE_VERSION = "0.1.6";
    delete process.env.npm_package_version;

    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(
      stateFile,
      JSON.stringify({
        lastCheck: Date.now(),
        latestVersion: "0.1.7",
        checkedFromVersion: "0.0.0",
      }),
      "utf8",
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "0.1.6" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { checkForUpdate } = await import("@/lib/cli/update-check");

    await expect(checkForUpdate()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const savedState = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
      checkedFromVersion?: string;
      latestVersion?: string | null;
    };

    expect(savedState.checkedFromVersion).toBe("0.1.6");
    expect(savedState.latestVersion).toBe("0.1.6");
  });
});
