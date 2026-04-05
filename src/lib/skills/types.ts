export interface SkillMetadata {
  name: string;
  description: string;
}

export interface SkillSummary extends SkillMetadata {
  source: "builtin" | "user";
  skillDir: string;
  skillFile: string;
}

export interface SkillValidationResult {
  ok: boolean;
  errors: string[];
}

export interface SkillScaffoldInput {
  homeDir?: string;
  name: string;
  description: string;
  triggers: string[];
  examples: string[];
  workflow: string;
}
