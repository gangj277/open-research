export interface SkillReference {
  path: string;
  label: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  slash: string;
  description: string;
  prompt: string;
  references?: SkillReference[];
  referenceContent?: Record<string, string>;
}

export const SKILLS: SkillDefinition[] = [];
export const SKILL_MAP = new Map<string, SkillDefinition>();
