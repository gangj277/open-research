import fs from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { getWorkspaceProjectFile } from "@/lib/fs/paths";
import { readJsonFile, writeJsonFile } from "@/lib/fs/json";
import { extractPdfText } from "@/lib/fs/pdf";
import type { WorkspaceProject, WorkspaceSourceMeta } from "./project";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "source";
}

function textFromHtml(html: string): string {
  const $ = load(html);
  const title = $("title").first().text().trim() || $("h1").first().text().trim();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  return [title ? `# ${title}` : "", bodyText].filter(Boolean).join("\n\n");
}

async function updateProjectSources(
  workspaceDir: string,
  source: WorkspaceSourceMeta
): Promise<void> {
  const projectFile = getWorkspaceProjectFile(workspaceDir);
  const project = await readJsonFile<WorkspaceProject | null>(projectFile, null);
  if (!project) {
    throw new Error("Workspace metadata is missing.");
  }
  project.sources.push(source);
  project.updatedAt = new Date().toISOString();
  await writeJsonFile(projectFile, project);
}

export async function addUrlSource(input: {
  workspaceDir: string;
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<WorkspaceSourceMeta> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch source URL: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    throw new Error("PDF URL ingestion is not implemented yet.");
  }

  const html = await response.text();
  const markdown = textFromHtml(html);
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const label = titleMatch?.[1]?.trim() || new URL(input.url).hostname;
  const fileName = `${slugify(label)}.md`;
  const relativePath = path.join("sources", fileName);
  const absolutePath = path.join(input.workspaceDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, markdown, "utf8");

  const source: WorkspaceSourceMeta = {
    id: crypto.randomUUID(),
    kind: "url",
    label,
    path: relativePath,
    addedAt: new Date().toISOString(),
  };
  await updateProjectSources(input.workspaceDir, source);
  return source;
}

export async function addFileSource(input: {
  workspaceDir: string;
  filePath: string;
}): Promise<WorkspaceSourceMeta> {
  const absoluteInput = path.resolve(input.filePath);
  const parsed = path.parse(absoluteInput);
  const slug = slugify(parsed.name);
  const markdownRelative = path.join("sources", `${slug}.md`);
  const markdownAbsolute = path.join(input.workspaceDir, markdownRelative);
  let markdown = "";

  if (parsed.ext.toLowerCase() === ".pdf") {
    const rawRelative = path.join("sources", `${slug}.pdf`);
    const rawAbsolute = path.join(input.workspaceDir, rawRelative);
    await fs.mkdir(path.dirname(rawAbsolute), { recursive: true });
    await fs.copyFile(absoluteInput, rawAbsolute);
    const { text } = await extractPdfText(absoluteInput);
    markdown = `# ${parsed.name}\n\n${text}`;
  } else {
    markdown = await fs.readFile(absoluteInput, "utf8");
    if (!markdown.startsWith("# ")) {
      markdown = `# ${parsed.name}\n\n${markdown}`;
    }
  }

  await fs.mkdir(path.dirname(markdownAbsolute), { recursive: true });
  await fs.writeFile(markdownAbsolute, markdown, "utf8");

  const source: WorkspaceSourceMeta = {
    id: crypto.randomUUID(),
    kind: parsed.ext.toLowerCase() === ".pdf" ? "pdf" : "file",
    label: parsed.name,
    path: markdownRelative,
    addedAt: new Date().toISOString(),
  };
  await updateProjectSources(input.workspaceDir, source);
  return source;
}
