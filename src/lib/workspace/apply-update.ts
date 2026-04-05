import fs from "node:fs/promises";
import path from "node:path";
import type { ProposedUpdate } from "@/lib/agent/state";

function resolveRelativePath(update: ProposedUpdate): string {
  if (update.key.startsWith("path:")) {
    return update.key.slice(5);
  }
  if (update.key.startsWith("note:")) {
    return `notes/${update.key.slice(5)}.md`;
  }
  if (update.key.startsWith("paper:")) {
    return `papers/${update.key.slice(6)}.tex`;
  }
  if (update.key.startsWith("experiment:")) {
    return `experiments/${update.key.slice(11)}.json`;
  }
  if (update.key.startsWith("source:")) {
    return `sources/${update.key.slice(7)}.md`;
  }
  return `artifacts/${update.key}.md`;
}

export async function applyProposedUpdate(
  workspaceDir: string,
  update: ProposedUpdate
): Promise<string> {
  const relativePath = resolveRelativePath(update);
  const absolutePath = path.join(workspaceDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, update.content, "utf8");
  return absolutePath;
}
