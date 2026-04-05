import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { initWorkspace, loadWorkspaceProject } from "@/lib/workspace/project";
import { addUrlSource } from "@/lib/workspace/sources";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-source-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("workspace source ingestion", () => {
  test("addUrlSource stores a normalized markdown source file and updates project metadata", async () => {
    const workspaceDir = await makeTempDir();
    await initWorkspace({ workspaceDir, title: "Sources" });

    const source = await addUrlSource({
      workspaceDir,
      url: "https://example.com/papers/model-collapse",
      fetchImpl: async () =>
        new Response(
          "<html><body><h1>Model Collapse</h1><p>Important evidence.</p></body></html>",
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        ),
    });

    expect(source.kind).toBe("url");
    expect(source.label).toMatch(/model collapse/i);

    const markdownPath = path.join(workspaceDir, source.path);
    const markdown = await fs.readFile(markdownPath, "utf8");
    expect(markdown).toMatch(/Model Collapse/);
    expect(markdown).toMatch(/Important evidence/);

    const project = await loadWorkspaceProject(workspaceDir);
    expect(project?.sources).toHaveLength(1);
    expect(project?.sources[0]?.path).toBe(source.path);
  });
});
