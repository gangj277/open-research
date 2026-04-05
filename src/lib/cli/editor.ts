import { spawnSync } from "node:child_process";

export function openInEditor(filePath: string): void {
  const editor = process.env.EDITOR;
  if (!editor) {
    throw new Error("Set $EDITOR to use `open-research skills edit`.");
  }
  const result = spawnSync(editor, [filePath], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Editor exited with code ${String(result.status ?? "unknown")}.`);
  }
}
