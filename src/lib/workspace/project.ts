import fs from "node:fs/promises";
import path from "node:path";
import { getWorkspaceMetaDir, getWorkspaceProjectFile, getWorkspaceSessionsDir } from "@/lib/fs/paths";
import { readJsonFile, writeJsonFile } from "@/lib/fs/json";

export interface WorkspaceSourceMeta {
  id: string;
  kind: "pdf" | "url" | "file";
  label: string;
  path: string;
  addedAt: string;
}

export interface WorkspaceProject {
  version: 1;
  title: string;
  createdAt: string;
  updatedAt: string;
  defaults: {
    editPolicy: "mixed";
  };
  sources: WorkspaceSourceMeta[];
  sessions: {
    activeSessionId: string | null;
  };
}

export interface InitWorkspaceOptions {
  workspaceDir: string;
  title?: string;
}

const MANAGED_DIRS = ["sources", "notes", "artifacts", "papers", "experiments"] as const;

export async function initWorkspace(
  options: InitWorkspaceOptions
): Promise<WorkspaceProject> {
  const workspaceDir = path.resolve(options.workspaceDir);
  await fs.mkdir(workspaceDir, { recursive: true });

  for (const dir of MANAGED_DIRS) {
    await fs.mkdir(path.join(workspaceDir, dir), { recursive: true });
  }

  await fs.mkdir(getWorkspaceMetaDir(workspaceDir), { recursive: true });
  await fs.mkdir(getWorkspaceSessionsDir(workspaceDir), { recursive: true });

  const timestamp = new Date().toISOString();
  const project: WorkspaceProject = {
    version: 1,
    title: options.title?.trim() || path.basename(workspaceDir),
    createdAt: timestamp,
    updatedAt: timestamp,
    defaults: {
      editPolicy: "mixed",
    },
    sources: [],
    sessions: {
      activeSessionId: null,
    },
  };

  await writeJsonFile(getWorkspaceProjectFile(workspaceDir), project);
  return project;
}

export async function loadWorkspaceProject(
  workspaceDir: string
): Promise<WorkspaceProject | null> {
  return readJsonFile<WorkspaceProject | null>(
    getWorkspaceProjectFile(path.resolve(workspaceDir)),
    null
  );
}
