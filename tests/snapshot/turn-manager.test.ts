import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TurnManager } from "@/lib/snapshot/turn-manager";

let tmpDir: string;
let tm: TurnManager;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "turnmgr-test-"));
  // Create .open-research dir so it gets excluded properly
  await fs.mkdir(path.join(tmpDir, ".open-research"), { recursive: true });
  tm = new TurnManager(tmpDir);
  await tm.init();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TurnManager", () => {
  test("beginTurn + endTurn records a turn snapshot", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "before");
    await tm.beginTurn(0);
    await fs.writeFile(path.join(tmpDir, "file.md"), "after");
    const snapshot = await tm.endTurn(0);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.turnIndex).toBe(0);
    expect(snapshot!.patch.modified).toContain("file.md");
    expect(snapshot!.before).not.toBe(snapshot!.after);
  });

  test("endTurn returns null if beginTurn was not called", async () => {
    const snapshot = await tm.endTurn(0);
    expect(snapshot).toBeNull();
  });

  test("endTurn returns null for mismatched turn index", async () => {
    await tm.beginTurn(0);
    const snapshot = await tm.endTurn(1);
    expect(snapshot).toBeNull();
  });

  test("turn with no changes produces empty patch", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "content");
    await tm.beginTurn(0);
    // No changes
    const snapshot = await tm.endTurn(0);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.patch.added).toHaveLength(0);
    expect(snapshot!.patch.modified).toHaveLength(0);
    expect(snapshot!.patch.deleted).toHaveLength(0);
  });

  test("multiple turns are tracked independently", async () => {
    // Turn 0: create a file
    await tm.beginTurn(0);
    await fs.writeFile(path.join(tmpDir, "a.md"), "alpha");
    const snap0 = await tm.endTurn(0);
    expect(snap0!.patch.added).toContain("a.md");

    // Turn 1: create another file
    await tm.beginTurn(1);
    await fs.writeFile(path.join(tmpDir, "b.md"), "beta");
    const snap1 = await tm.endTurn(1);
    expect(snap1!.patch.added).toContain("b.md");
    expect(snap1!.patch.added).not.toContain("a.md");

    expect(tm.getTurnSnapshots()).toHaveLength(2);
  });

  test("revertToTurn restores files from reverted turns", async () => {
    // Turn 0: create file
    await tm.beginTurn(0);
    await fs.writeFile(path.join(tmpDir, "notes.md"), "initial");
    await tm.endTurn(0);

    // Turn 1: modify file and add another
    await tm.beginTurn(1);
    await fs.writeFile(path.join(tmpDir, "notes.md"), "modified");
    await fs.writeFile(path.join(tmpDir, "extra.md"), "extra content");
    await tm.endTurn(1);

    // Revert turn 1 (go back to state after turn 0)
    const result = await tm.revertToTurn(0);
    expect(result.revertedTurns).toContain(1);

    // notes.md should be back to "initial"
    const content = await fs.readFile(path.join(tmpDir, "notes.md"), "utf8");
    expect(content).toBe("initial");

    // extra.md should be deleted
    await expect(fs.access(path.join(tmpDir, "extra.md"))).rejects.toThrow();
  });

  test("unrevert restores to pre-revert state", async () => {
    await tm.beginTurn(0);
    await fs.writeFile(path.join(tmpDir, "file.md"), "original");
    await tm.endTurn(0);

    await tm.beginTurn(1);
    await fs.writeFile(path.join(tmpDir, "file.md"), "changed");
    await tm.endTurn(1);

    // Revert
    await tm.revertToTurn(0);
    expect(await fs.readFile(path.join(tmpDir, "file.md"), "utf8")).toBe("original");

    // Unrevert
    await tm.unrevert();
    expect(await fs.readFile(path.join(tmpDir, "file.md"), "utf8")).toBe("changed");
  });

  test("canUnrevert returns correct state", async () => {
    expect(tm.canUnrevert()).toBe(false);

    await tm.beginTurn(0);
    await fs.writeFile(path.join(tmpDir, "a.md"), "first");
    await tm.endTurn(0);

    await tm.beginTurn(1);
    await fs.writeFile(path.join(tmpDir, "b.md"), "second");
    await tm.endTurn(1);

    // After revert, canUnrevert should be true
    await tm.revertToTurn(0);
    expect(tm.canUnrevert()).toBe(true);

    // After unrevert, canUnrevert should be false
    await tm.unrevert();
    expect(tm.canUnrevert()).toBe(false);
  });

  test("rehydrate restores snapshot history", async () => {
    // Create some snapshots
    await tm.beginTurn(0);
    await fs.writeFile(path.join(tmpDir, "a.md"), "alpha");
    const snap0 = await tm.endTurn(0);

    await tm.beginTurn(1);
    await fs.writeFile(path.join(tmpDir, "b.md"), "beta");
    const snap1 = await tm.endTurn(1);

    // Create a new TurnManager and rehydrate
    const tm2 = new TurnManager(tmpDir);
    await tm2.init();
    tm2.rehydrate([snap0!, snap1!]);

    expect(tm2.getTurnSnapshots()).toHaveLength(2);
    expect(tm2.turnCount).toBe(2);
  });

  test("getTurnDiff returns diff text", async () => {
    await fs.writeFile(path.join(tmpDir, "file.md"), "original\n");
    await tm.beginTurn(0);
    await fs.writeFile(path.join(tmpDir, "file.md"), "original\nnew line\n");
    await tm.endTurn(0);

    const diff = await tm.getTurnDiff(0);
    expect(diff).toContain("+new line");
  });
});
