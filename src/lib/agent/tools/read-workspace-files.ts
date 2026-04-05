import type { WorkspaceContext } from "../state";

/**
 * Read workspace files by key. Returns JSON map of key → content.
 */
export async function executeReadWorkspaceFiles(
  args: { keys: string[] },
  ctx: WorkspaceContext
): Promise<string> {
  const result: Record<string, string> = {};

  for (const key of args.keys) {
    if (key in ctx.workspaceFiles) {
      result[key] = ctx.workspaceFiles[key];
    } else if (ctx.readWorkspaceFileByKey) {
      const loaded = await ctx.readWorkspaceFileByKey(key);
      if (loaded != null) {
        ctx.workspaceFiles[key] = loaded;
        result[key] = loaded;
      } else {
        result[key] = `[File not found: "${key}". Available keys: ${ctx.availableKeys.join(", ")}]`;
      }
    } else {
      result[key] = `[File not found: "${key}". Available keys: ${ctx.availableKeys.join(", ")}]`;
    }
  }

  return JSON.stringify(result, null, 2);
}
