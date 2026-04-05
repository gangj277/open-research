import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  loadMemories,
  addMemory,
  deleteMemory,
  clearMemories,
  formatMemoriesForPrompt,
} from "@/lib/memory/store";

const tempDirs: string[] = [];

async function makeTempHome() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

describe("memory store", () => {
  test("returns empty array when no memories exist", async () => {
    const home = await makeTempHome();
    const memories = await loadMemories({ homeDir: home });
    expect(memories).toEqual([]);
  });

  test("adds and loads a memory", async () => {
    const home = await makeTempHome();
    const mem = await addMemory(
      { content: "User is a PhD student in neuroscience", category: "user" },
      { homeDir: home }
    );
    expect(mem.id).toBeTruthy();
    expect(mem.content).toBe("User is a PhD student in neuroscience");
    expect(mem.category).toBe("user");
    expect(mem.relevanceCount).toBe(1);

    const loaded = await loadMemories({ homeDir: home });
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe("User is a PhD student in neuroscience");
  });

  test("deduplicates similar memories by reinforcing existing", async () => {
    const home = await makeTempHome();
    await addMemory(
      { content: "User is a PhD student in neuroscience at MIT", category: "user" },
      { homeDir: home }
    );
    await addMemory(
      { content: "User is a PhD student in neuroscience at MIT working on attention", category: "user" },
      { homeDir: home }
    );

    const loaded = await loadMemories({ homeDir: home });
    // Should still be 1 memory, reinforced
    expect(loaded).toHaveLength(1);
    expect(loaded[0].relevanceCount).toBe(2);
    // Should keep the longer (more detailed) version
    expect(loaded[0].content).toContain("attention");
  });

  test("stores multiple different memories", async () => {
    const home = await makeTempHome();
    await addMemory({ content: "Researcher in biology", category: "user" }, { homeDir: home });
    await addMemory({ content: "Prefers Python over R", category: "preference" }, { homeDir: home });
    await addMemory({ content: "Working on climate modeling", category: "project" }, { homeDir: home });

    const loaded = await loadMemories({ homeDir: home });
    expect(loaded).toHaveLength(3);
  });

  test("deletes a memory by id", async () => {
    const home = await makeTempHome();
    const mem = await addMemory(
      { content: "Temporary fact", category: "context" },
      { homeDir: home }
    );

    let loaded = await loadMemories({ homeDir: home });
    expect(loaded).toHaveLength(1);

    const deleted = await deleteMemory(mem.id, { homeDir: home });
    expect(deleted).toBe(true);

    loaded = await loadMemories({ homeDir: home });
    expect(loaded).toHaveLength(0);
  });

  test("returns false when deleting non-existent memory", async () => {
    const home = await makeTempHome();
    const deleted = await deleteMemory("fake-id", { homeDir: home });
    expect(deleted).toBe(false);
  });

  test("clears all memories", async () => {
    const home = await makeTempHome();
    await addMemory({ content: "Fact 1", category: "user" }, { homeDir: home });
    await addMemory({ content: "Fact 2", category: "preference" }, { homeDir: home });

    await clearMemories({ homeDir: home });
    const loaded = await loadMemories({ homeDir: home });
    expect(loaded).toHaveLength(0);
  });
});

describe("formatMemoriesForPrompt", () => {
  test("returns empty string for no memories", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  test("formats memories grouped by category", () => {
    const memories = [
      {
        id: "1", content: "PhD student", category: "user" as const,
        createdAt: "", lastRelevantAt: "", relevanceCount: 1,
      },
      {
        id: "2", content: "Prefers Python", category: "preference" as const,
        createdAt: "", lastRelevantAt: "", relevanceCount: 1,
      },
      {
        id: "3", content: "Working on climate", category: "project" as const,
        createdAt: "", lastRelevantAt: "", relevanceCount: 1,
      },
    ];

    const result = formatMemoriesForPrompt(memories);
    expect(result).toContain("What I Remember About You");
    expect(result).toContain("PhD student");
    expect(result).toContain("Prefers Python");
    expect(result).toContain("Working on climate");
    expect(result).toContain("About you");
    expect(result).toContain("Your preferences");
    expect(result).toContain("Your projects");
  });
});
