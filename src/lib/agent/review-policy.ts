import type { ProposedUpdate } from "./state";

export interface UpdateRiskResult {
  policy: "auto-apply" | "review-required";
  reason: string;
}

function isManagedSafePath(key: string): boolean {
  if (!key.startsWith("path:")) return false;
  const relativePath = key.slice(5);
  return (
    relativePath.startsWith("notes/") ||
    relativePath.startsWith("artifacts/") ||
    relativePath.startsWith("sources/") ||
    relativePath.startsWith("run/")
  );
}

export function classifyUpdateRisk(update: ProposedUpdate): UpdateRiskResult {
  // Run archive: auto-approve both new files and edits
  if (update.key.startsWith("path:run/")) {
    return {
      policy: "auto-apply",
      reason: "Files in run/ archive are agent-managed and safe to auto-apply.",
    };
  }

  if (update.type === "new" && isManagedSafePath(update.key)) {
    return {
      policy: "auto-apply",
      reason: "New files in managed workspace folders are safe to auto-apply.",
    };
  }

  return {
    policy: "review-required",
    reason: "Existing-file edits and writes outside managed folders require review.",
  };
}
