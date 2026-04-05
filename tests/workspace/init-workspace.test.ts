import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { initWorkspace, loadWorkspaceProject } from "@/lib/workspace/project";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-workspace-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("workspace init", () => {
  test("initWorkspace creates managed folders and metadata without analysis side effects", async () => {
    const workspaceDir = await makeTempDir();

    const project = await initWorkspace({
      workspaceDir,
      title: "My Literature Review",
    });

    expect(project.title).toBe("My Literature Review");

    for (const folder of [
      "sources",
      "notes",
      "artifacts",
      "papers",
      "experiments",
      ".open-research",
      ".open-research/sessions",
    ]) {
      await expect(
        fs.stat(path.join(workspaceDir, folder)).then((value) => value.isDirectory())
      ).resolves.toBe(true);
    }

    const loaded = await loadWorkspaceProject(workspaceDir);
    expect(loaded?.title).toBe("My Literature Review");
    expect(loaded?.sources).toEqual([]);
  });
});
