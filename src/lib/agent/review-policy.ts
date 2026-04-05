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
    relativePath.startsWith("sources/")
  );
}

export function classifyUpdateRisk(update: ProposedUpdate): UpdateRiskResult {
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
