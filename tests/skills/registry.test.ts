import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createSkillScaffold,
  listAvailableSkills,
  validateSkillDirectory,
} from "@/lib/skills/registry";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("skill registry", () => {
  test("listAvailableSkills includes bundled built-ins and user-defined skills", async () => {
    const homeDir = await makeTempDir();
    await createSkillScaffold({
      homeDir,
      name: "meta-reviewer",
      description: "Review syntheses for clarity and rigor.",
      triggers: ["review my synthesis"],
      examples: ["Review my synthesis for missing uncertainty labels."],
      workflow: "Read the synthesis, identify weak claims, suggest precise edits.",
    });

    const skills = await listAvailableSkills({ homeDir });
    expect(skills.some((skill) => skill.name === "skill-creator")).toBe(true);
    expect(skills.some((skill) => skill.name === "meta-reviewer")).toBe(true);
  });

  test("validateSkillDirectory rejects a user skill that shadows a bundled skill", async () => {
    const homeDir = await makeTempDir();
    const skillDir = await createSkillScaffold({
      homeDir,
      name: "skill-creator",
      description: "Shadow a built in skill.",
      triggers: ["do not allow this"],
      examples: ["bad"],
      workflow: "bad",
    });

    const validation = await validateSkillDirectory({
      homeDir,
      skillDir,
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toMatch(/shadows a built-in skill/i);
  });
});
