import type { ResearchCharter } from "@/lib/agent/state";

export function parseCharterYaml(raw: string): ResearchCharter {
  const id = crypto.randomUUID();
  const getField = (name: string): string => {
    const match = raw.match(new RegExp(`^${name}:\\s*\\|?\\s*\\n((?:  .+\\n?)*)`, "m"));
    return match?.[1]?.replace(/^ {2}/gm, "").trim() ?? "";
  };
  const getList = (name: string): string[] => {
    const match = raw.match(new RegExp(`^${name}:\\s*\\n((?:\\s*- .+\\n?)*)`, "m"));
    if (!match?.[1]) return [];
    return match[1].split("\n").map((line) => line.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  };
  return {
    id,
    researchQuestion: getField("researchQuestion") || raw.split("\n")[0] || "Research question",
    successCriteria: getList("successCriteria"),
    scopeBoundaries: getList("scopeBoundaries"),
    knownStartingPoints: getList("knownStartingPoints"),
    proposedSteps: getList("proposedSteps"),
    rawMarkdown: raw,
    createdAt: new Date().toISOString(),
  };
}
