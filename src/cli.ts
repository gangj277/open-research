#!/usr/bin/env node
import React from "react";
import path from "node:path";
import { Command } from "commander";
import { render } from "ink";
import { initWorkspace, loadWorkspaceProject } from "@/lib/workspace/project";
import { addFileSource, addUrlSource } from "@/lib/workspace/sources";
import { importCodexAuth } from "@/lib/auth/import-codex";
import { loginWithBrowser } from "@/lib/auth/login";
import { clearStoredAuth, loadStoredAuth } from "@/lib/auth/store";
import { getAuthStatus } from "@/lib/auth/status";
import {
  createSkillScaffold,
  listAvailableSkills,
  validateSkillDirectory,
} from "@/lib/skills/registry";
import { getOpenResearchSkillsDir } from "@/lib/fs/paths";
import { openInEditor } from "@/lib/cli/editor";
import { prompt } from "@/lib/cli/prompts";
import { formatDateTime } from "@/lib/cli/format";
import { ensureOpenResearchConfig } from "@/lib/config/store";
import { App } from "@/tui/app";

const program = new Command();

program
  .name("open-research")
  .description("Local-first research CLI powered by ChatGPT/Codex auth.")
  .argument("[workspacePath]", "Optional workspace path to open")
  .action(async (workspacePath?: string) => {
    await ensureOpenResearchConfig();
    const target = workspacePath ? path.resolve(workspacePath) : process.cwd();
    const project = await loadWorkspaceProject(target);
    const auth = await loadStoredAuth();
    render(
      React.createElement(App, {
        initialState: {
          authStatus: auth ? "connected" : "missing",
          workspacePath: project ? target : null,
          screen: "home",
          pendingUpdates: [],
        },
      }),
      {
        kittyKeyboard: {
          mode: "auto",
          flags: ["disambiguateEscapeCodes", "reportAlternateKeys"],
        },
      }
    );
  });

program
  .command("init")
  .argument("[workspacePath]")
  .description("Initialize an Open Research workspace.")
  .action(async (workspacePath?: string) => {
    await ensureOpenResearchConfig();
    const target = path.resolve(workspacePath ?? process.cwd());
    const project = await initWorkspace({ workspaceDir: target });
    console.log(`Initialized workspace: ${target}`);
    console.log(`Title: ${project.title}`);
  });

const auth = program.command("auth").description("Manage OpenAI auth");

auth
  .command("login")
  .description("Open a browser and connect your OpenAI account.")
  .action(async () => {
    await ensureOpenResearchConfig();
    const result = await loginWithBrowser();
    console.log(`Connected OpenAI account ${result.tokens.accountId}`);
  });

auth
  .command("import-codex")
  .description("Import an existing ~/.codex/auth.json session.")
  .action(async () => {
    await ensureOpenResearchConfig();
    const result = await importCodexAuth();
    console.log(`Imported Codex auth for account ${result.accountId}`);
  });

auth
  .command("status")
  .description("Show stored auth health and capabilities.")
  .action(async () => {
    await ensureOpenResearchConfig();
    const status = await getAuthStatus();
    if (!status.connected && !("stored" in status)) {
      console.log(status.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Connection: ${status.connected ? "connected" : "degraded"}`);
    console.log(`Message: ${status.message}`);
    if ("stored" in status) {
      console.log(`Account: ${status.stored.tokens.accountId}`);
      console.log(`Expires: ${formatDateTime(new Date(status.stored.tokens.expires).toISOString())}`);
    }
  });

auth
  .command("logout")
  .description("Clear stored CLI auth.")
  .action(async () => {
    await ensureOpenResearchConfig();
    await clearStoredAuth();
    console.log("Cleared stored Open Research auth.");
  });

const skills = program.command("skills").description("Manage research skills");
const source = program.command("source").description("Add sources to a workspace");

skills
  .command("list")
  .description("List built-in and user-defined skills.")
  .action(async () => {
    await ensureOpenResearchConfig();
    const available = await listAvailableSkills();
    for (const skill of available) {
      console.log(`${skill.name} [${skill.source}] - ${skill.description}`);
    }
  });

skills
  .command("create")
  .argument("[name]")
  .description("Scaffold a new user skill.")
  .action(async (name?: string) => {
    await ensureOpenResearchConfig();
    const skillName = name?.trim() || (await prompt("Skill name: "));
    const description = await prompt("Description: ");
    const triggers = (await prompt("Trigger phrases (comma separated): "))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const examples = (await prompt("Example requests (comma separated): "))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const workflow = await prompt("Workflow summary: ");
    const skillDir = await createSkillScaffold({
      name: skillName,
      description,
      triggers,
      examples,
      workflow,
    });
    const validation = await validateSkillDirectory({ skillDir });
    if (!validation.ok) {
      console.error(validation.errors.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(`Created skill at ${skillDir}`);
  });

skills
  .command("edit")
  .argument("<name>")
  .description("Open a user skill in $EDITOR.")
  .action(async (name: string) => {
    await ensureOpenResearchConfig();
    const skillDir = path.join(getOpenResearchSkillsDir(), name);
    openInEditor(path.join(skillDir, "SKILL.md"));
    const validation = await validateSkillDirectory({ skillDir });
    if (!validation.ok) {
      console.error(validation.errors.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${name}`);
  });

skills
  .command("validate")
  .argument("[nameOrPath]")
  .description("Validate one user skill.")
  .action(async (nameOrPath?: string) => {
    await ensureOpenResearchConfig();
    const skillDir = nameOrPath
      ? path.isAbsolute(nameOrPath)
        ? nameOrPath
        : path.join(getOpenResearchSkillsDir(), nameOrPath)
      : getOpenResearchSkillsDir();

    const stat = await import("node:fs/promises").then((fs) =>
      fs.stat(skillDir).catch(() => null)
    );

    if (!stat) {
      throw new Error(`Skill path not found: ${skillDir}`);
    }

    if (stat.isDirectory() && nameOrPath) {
      const validation = await validateSkillDirectory({ skillDir });
      if (!validation.ok) {
        console.error(validation.errors.join("\n"));
        process.exitCode = 1;
        return;
      }
      console.log(`Validated ${skillDir}`);
      return;
    }

    const available = await listAvailableSkills();
    for (const skill of available.filter((item) => item.source === "user")) {
      const validation = await validateSkillDirectory({ skillDir: skill.skillDir });
      console.log(`${skill.name}: ${validation.ok ? "ok" : validation.errors.join("; ")}`);
    }
  });

source
  .command("add-file")
  .argument("<filePath>")
  .description("Add a local file source to the current workspace.")
  .action(async (filePath: string) => {
    await ensureOpenResearchConfig();
    const workspace = process.cwd();
    const result = await addFileSource({
      workspaceDir: workspace,
      filePath,
    });
    console.log(`Added source ${result.label} -> ${result.path}`);
  });

source
  .command("add-url")
  .argument("<url>")
  .description("Fetch and add a URL source to the current workspace.")
  .action(async (url: string) => {
    await ensureOpenResearchConfig();
    const workspace = process.cwd();
    const result = await addUrlSource({
      workspaceDir: workspace,
      url,
    });
    console.log(`Added source ${result.label} -> ${result.path}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
