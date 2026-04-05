import type { SkillDefinition } from "../prompts/skills";

/**
 * Read a reference file from an active skill's reference library.
 * Looks up content directly from the skill's `referenceContent` map.
 */
export function executeReadSkillReference(
  args: { skill_id: string; path: string },
  activeSkills: SkillDefinition[]
): { result: string } {
  const skill = activeSkills.find((s) => s.id === args.skill_id);
  if (!skill) {
    return { result: `Skill "${args.skill_id}" is not currently active.` };
  }
  if (!skill.referenceContent) {
    return { result: `No references available for skill "${args.skill_id}".` };
  }
  const content = skill.referenceContent[args.path];
  if (!content) {
    const available = Object.keys(skill.referenceContent).join(", ");
    return {
      result: `Reference "${args.path}" not found for skill "${args.skill_id}". Available: ${available}`,
    };
  }
  return { result: content };
}
