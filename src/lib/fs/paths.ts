import os from "node:os";
import path from "node:path";

export interface PathOptions {
  homeDir?: string;
}

export function resolveHomeDir(options?: PathOptions): string {
  return options?.homeDir ?? os.homedir();
}

export function getOpenResearchRoot(options?: PathOptions): string {
  return path.join(resolveHomeDir(options), ".open-research");
}

export function getOpenResearchAuthFile(options?: PathOptions): string {
  return path.join(getOpenResearchRoot(options), "auth.json");
}

export function getOpenResearchGeminiAuthFile(options?: PathOptions): string {
  return path.join(getOpenResearchRoot(options), "gemini-auth.json");
}

export function getOpenResearchConfigFile(options?: PathOptions): string {
  return path.join(getOpenResearchRoot(options), "config.json");
}

export function getOpenResearchSkillsDir(options?: PathOptions): string {
  return path.join(getOpenResearchRoot(options), "skills");
}

export function getWorkspaceMetaDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".open-research");
}

export function getWorkspaceProjectFile(workspaceDir: string): string {
  return path.join(getWorkspaceMetaDir(workspaceDir), "project.json");
}

export function getWorkspaceSessionsDir(workspaceDir: string): string {
  return path.join(getWorkspaceMetaDir(workspaceDir), "sessions");
}
