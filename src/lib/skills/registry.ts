import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getOpenResearchSkillsDir, type PathOptions } from "@/lib/fs/paths";
import type {
  SkillScaffoldInput,
  SkillSummary,
  SkillValidationResult,
} from "./types";

const BUILTIN_SKILLS_DIR = [
  path.resolve(path.join(import.meta.dirname, "../../../builtin-skills")),
  path.resolve(path.join(import.meta.dirname, "../builtin-skills")),
].find((candidate) => fsSync.existsSync(candidate)) ?? path.resolve(path.join(import.meta.dirname, "../../../builtin-skills"));

function normalizeSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureUserSkillsDir(options?: PathOptions): Promise<string> {
  const dir = getOpenResearchSkillsDir(options);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readSkillSummary(
  skillDir: string,
  source: SkillSummary["source"]
): Promise<SkillSummary | null> {
  const skillFile = path.join(skillDir, "SKILL.md");
  try {
    const raw = await fs.readFile(skillFile, "utf8");
    const parsed = matter(raw);
    const name = String(parsed.data.name ?? "").trim();
    const description = String(parsed.data.description ?? "").trim();
    if (!name || !description) {
      return null;
    }
    return {
      name,
      description,
      source,
      skillDir,
      skillFile,
    };
  } catch {
    return null;
  }
}

async function listSkillsInDirectory(
  rootDir: string,
  source: SkillSummary["source"]
): Promise<SkillSummary[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const results = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readSkillSummary(path.join(rootDir, entry.name), source))
  );
  return results.filter((value): value is SkillSummary => Boolean(value));
}

export async function listAvailableSkills(
  options?: PathOptions
): Promise<SkillSummary[]> {
  const userDir = await ensureUserSkillsDir(options);
  const [builtins, userSkills] = await Promise.all([
    listSkillsInDirectory(BUILTIN_SKILLS_DIR, "builtin"),
    listSkillsInDirectory(userDir, "user"),
  ]);
  return [...builtins, ...userSkills].sort((a, b) => a.name.localeCompare(b.name));
}

export async function validateSkillDirectory(input: {
  homeDir?: string;
  skillDir: string;
}): Promise<SkillValidationResult> {
  const errors: string[] = [];
  const skillFile = path.join(input.skillDir, "SKILL.md");
  const raw = await fs.readFile(skillFile, "utf8").catch(() => "");
  if (!raw) {
    return { ok: false, errors: ["SKILL.md is missing."] };
  }

  const parsed = matter(raw);
  const name = String(parsed.data.name ?? "").trim();
  const description = String(parsed.data.description ?? "").trim();
  const normalizedDirName = path.basename(input.skillDir);
  const normalizedName = normalizeSkillName(name);

  if (!name) {
    errors.push("Skill frontmatter requires a name.");
  }
  if (!description) {
    errors.push("Skill frontmatter requires a description.");
  }
  if (normalizedName && normalizedName !== normalizedDirName) {
    errors.push("Skill folder name must match the normalized skill name.");
  }

  const builtins = await listSkillsInDirectory(BUILTIN_SKILLS_DIR, "builtin");
  if (builtins.some((skill) => skill.name === name)) {
    errors.push(`User skill "${name}" shadows a built-in skill.`);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export async function createSkillScaffold(
  input: SkillScaffoldInput
): Promise<string> {
  const skillsDir = await ensureUserSkillsDir({ homeDir: input.homeDir });
  const name = normalizeSkillName(input.name);
  const skillDir = path.join(skillsDir, name);
  await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
  await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });

  const body = `---
name: ${name}
description: ${input.description}
---

# ${input.name}

## Triggers

${input.triggers.map((trigger) => `- ${trigger}`).join("\n")}

## Examples

${input.examples.map((example) => `- ${example}`).join("\n")}

## Workflow

${input.workflow}
`;

  await fs.writeFile(path.join(skillDir, "SKILL.md"), body, "utf8");
  return skillDir;
}
