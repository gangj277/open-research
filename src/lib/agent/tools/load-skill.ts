import { SKILL_MAP, SKILLS } from "../prompts/skills";

/**
 * Load a skill by ID.
 *
 * When `promoted` is true, the skill prompt has been added to the system message
 * by graph.ts — return a short confirmation to avoid duplication.
 * When `promoted` is false (legacy path), return the full prompt as a tool result.
 */
export function executeLoadSkill(
  args: { skill_id: string },
  promoted?: boolean
): { result: string; skillId: string | null } {
  const skill = SKILL_MAP.get(args.skill_id);

  if (!skill) {
    const available = SKILLS.map((s) => `"${s.id}"`).join(", ");
    return {
      result: `Unknown skill "${args.skill_id}". Available skills: ${available}`,
      skillId: null,
    };
  }

  return {
    result: promoted
      ? `Skill "${skill.name}" activated and added to system context. Follow its instructions.`
      : `Skill "${skill.name}" loaded.\n\n${skill.prompt}`,
    skillId: skill.id,
  };
}
