import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { listAvailableSkills } from "./registry";

export interface RuntimeSkill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  skillDir: string;
}

export async function loadRuntimeSkillByName(input: {
  homeDir?: string;
  name: string;
}): Promise<RuntimeSkill | null> {
  const skills = await listAvailableSkills({ homeDir: input.homeDir });
  const match = skills.find((skill) => skill.name === input.name);
  if (!match) {
    return null;
  }
  const raw = await fs.readFile(path.join(match.skillDir, "SKILL.md"), "utf8");
  const parsed = matter(raw);
  return {
    id: match.name,
    name: match.name,
    description: match.description,
    prompt: parsed.content.trim(),
    skillDir: match.skillDir,
  };
}

export async function readSkillReferenceFile(
  skillDir: string,
  referencePath: string
): Promise<string> {
  const fullPath = path.join(skillDir, "references", referencePath);
  return fs.readFile(fullPath, "utf8");
}
