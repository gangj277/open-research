import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SnapshotEngine } from "@/lib/snapshot/engine";

let tmpDir: string;
let engine: SnapshotEngine;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-test-"));
  engine = new SnapshotEngine(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("SnapshotEngine", () => {
  test("init creates shadow git repo", async () => {
    await engine.init();
    const gitDir = path.join(tmpDir, ".open-research", "snapshots", ".git");
    const stat = await fs.stat(gitDir);
    expect(stat.isDirectory()).toBe(true);
  });

  test("track returns a 40-char tree hash", async () => {
    await fs.writeFile(path.join(tmpDir, "test.md"), "hello");
    const hash = await engine.track();
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  test("track returns same hash for identical content", async () => {
    await fs.writeFile(path.join(tmpDir, "test.md"), "hello");
    const hash1 = await engine.track();
    const hash2 = await engine.track();
    expect(hash1).toBe(hash2);
  });

  test("track returns different hash after file change", async () => {
    await fs.writeFile(path.join(tmpDir, "test.md"), "hello");
    const hash1 = await engine.track();
    await fs.writeFile(path.join(tmpDir, "test.md"), "world");
    const hash2 = await engine.track();
    expect(hash1).not.toBe(hash2);
  });

  test("patch detects added files", async () => {
    const hash1 = await engine.track();
    await fs.writeFile(path.join(tmpDir, "new.md"), "content");
    const hash2 = await engine.track();
    const patch = await engine.patch(hash1, hash2);
    expect(patch.added).toContain("new.md");
    expect(patch.modified).toHaveLength(0);
    expect(patch.deleted).toHaveLength(0);
  });

  test("patch detects modified files", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "original");
    const hash1 = await engine.track();
    await fs.writeFile(path.join(tmpDir, "file.md"), "changed");
    const hash2 = await engine.track();
    const patch = await engine.patch(hash1, hash2);
    expect(patch.modified).toContain("file.md");
  });

  test("patch detects deleted files", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "content");
    const hash1 = await engine.track();
    await fs.unlink(path.join(tmpDir, "file.md"));
    const hash2 = await engine.track();
    const patch = await engine.patch(hash1, hash2);
    expect(patch.deleted).toContain("file.md");
  });

  test("patch returns empty for identical hashes", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "content");
    const hash = await engine.track();
    const patch = await engine.patch(hash, hash);
    expect(patch.added).toHaveLength(0);
    expect(patch.modified).toHaveLength(0);
    expect(patch.deleted).toHaveLength(0);
  });

  test("revert restores modified files", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "original");
    const hash1 = await engine.track();
    await fs.writeFile(path.join(tmpDir, "file.md"), "changed");
    const hash2 = await engine.track();
    const patch = await engine.patch(hash1, hash2);

    await engine.revert(hash1, patch);

    const content = await fs.readFile(path.join(tmpDir, "file.md"), "utf8");
    expect(content).toBe("original");
  });

  test("revert deletes files that were added", async () => {
    const hash1 = await engine.track();
    await fs.writeFile(path.join(tmpDir, "new.md"), "content");
    const hash2 = await engine.track();
    const patch = await engine.patch(hash1, hash2);

    await engine.revert(hash1, patch);

    await expect(fs.access(path.join(tmpDir, "new.md"))).rejects.toThrow();
  });

  test("revert restores deleted files", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "content");
    const hash1 = await engine.track();
    await fs.unlink(path.join(tmpDir, "file.md"));
    const hash2 = await engine.track();
    const patch = await engine.patch(hash1, hash2);

    await engine.revert(hash1, patch);

    const content = await fs.readFile(path.join(tmpDir, "file.md"), "utf8");
    expect(content).toBe("content");
  });

  test("excludes .open-research directory from snapshots", async () => {
    await fs.mkdir(path.join(tmpDir, ".open-research"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".open-research", "ontology.json"), "{}");
    await fs.writeFile(path.join(tmpDir, "notes.md"), "research");
    const hash1 = await engine.track();

    await fs.writeFile(path.join(tmpDir, ".open-research", "ontology.json"), '{"updated": true}');
    const hash2 = await engine.track();

    // The internal file change should not appear in the patch
    const patch = await engine.patch(hash1, hash2);
    expect(patch.modified).not.toContain(".open-research/ontology.json");
  });

  test("diff returns unified diff text", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "line 1\n");
    const hash1 = await engine.track();
    await fs.writeFile(path.join(tmpDir, "file.md"), "line 1\nline 2\n");
    const hash2 = await engine.track();

    const diffText = await engine.diff(hash1, hash2);
    expect(diffText).toContain("+line 2");
  });

  test("gc runs without error", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "content");
    await engine.track();
    await expect(engine.gc()).resolves.not.toThrow();
  });
});
