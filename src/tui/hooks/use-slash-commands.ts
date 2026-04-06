import { startTransition } from "react";
import type { ProposedUpdate, AgentMode, PlanningState } from "@/lib/agent/state";
import type { LLMMessage } from "@/lib/llm/types";
import { scanWorkspace } from "@/lib/workspace/scan";
import { initWorkspace, loadWorkspaceProject } from "@/lib/workspace/project";
import { createProviderFromStoredAuth } from "@/lib/llm/provider-factory";
import { listAvailableSkills } from "@/lib/skills/registry";
import { appendSessionEvent } from "@/lib/workspace/sessions";
import { loginWithBrowser } from "@/lib/auth/login";
import { importCodexAuth } from "@/lib/auth/import-codex";
import { clearStoredAuth } from "@/lib/auth/store";
import { getAuthStatus } from "@/lib/auth/status";
import {
  saveOpenResearchConfig,
  themeValues,
  getConfiguredOpenAIApiKey,
  type OpenResearchConfig,
  type Theme,
} from "@/lib/config/store";
import { getAvailableModels, selectModelForTask } from "@/lib/llm/provider-catalog";
import { hasConfiguredProvider } from "@/lib/llm/provider-resolution";
import {
  estimateConversationTokens,
  getContextWindow,
  getCompactThreshold,
  manualCompact,
  type SessionTokenUsage,
} from "@/lib/agent/context-manager";
import { loadAllMemories, deleteMemory, clearMemories } from "@/lib/memory/store";
import { generateInitialAgentsMd } from "@/lib/workspace/init-agents-md";
import { getSemanticScholarApiKey, getOpenAlexApiKey } from "@/lib/config/store";
import { startPreviewServer, type PreviewServer } from "@/lib/preview/server";
import { SLASH_COMMANDS, type SlashCommand, type WorkspaceFile } from "@/tui/commands";
import type { ConversationMessage } from "@/tui/streaming";
import { resetPendingQuestions } from "@/lib/agent/tools/ask-user";
import { clearAllTasks } from "@/lib/agent/tools/tasks";

export interface SlashCommandContext {
  homeDir?: string;
  workspacePath: string | null;
  hasAuth: boolean;
  config: OpenResearchConfig | null;
  messages: ConversationMessage[];
  history: LLMMessage[];
  skills: Array<{ name: string; description: string; source: string }>;
  workspaceFiles: WorkspaceFile[];
  sessionId: string;
  sessionTokens: SessionTokenUsage;
  agentMode: AgentMode;
  previewRef: React.MutableRefObject<PreviewServer | null>;
  // State setters
  addSystemMessage: (text: string) => void;
  replaceMessages: (msgs: ConversationMessage[]) => void;
  setBusy: (busy: boolean) => void;
  setAuthStatus: (status: "missing" | "connected") => void;
  setWorkspacePath: (path: string | null) => void;
  setWorkspaceFiles: (files: WorkspaceFile[]) => void;
  setConfig: (config: OpenResearchConfig) => void;
  setTheme: (theme: Theme) => void;
  setAgentMode: (mode: AgentMode) => void;
  setHistory: React.Dispatch<React.SetStateAction<LLMMessage[]>>;
  setActiveSkills: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; description: string; prompt: string; skillDir: string }>>>;
  setPendingUpdates: React.Dispatch<React.SetStateAction<ProposedUpdate[]>>;
  setStatusLine: (line: string) => void;
  setPlanningState: React.Dispatch<React.SetStateAction<PlanningState>>;
  setTokenDisplay: (display: string) => void;
  setScreen: (screen: "main" | "config" | "resume") => void;
  setComposerFocused: (focused: boolean) => void;
  setResumeSessions: (sessions: import("@/lib/workspace/sessions").SavedSession[]) => void;
  exitApp: () => void;
}

export async function executeSlashCommand(cmd: SlashCommand, args: string, ctx: SlashCommandContext) {
  const {
    homeDir, workspacePath, hasAuth, config, messages, history, skills, workspaceFiles,
    sessionId, sessionTokens, agentMode,
    addSystemMessage, replaceMessages, setBusy, setAuthStatus, setWorkspacePath, setWorkspaceFiles,
    setConfig, setTheme, setAgentMode, setHistory, setActiveSkills, setPendingUpdates,
    setStatusLine, setPlanningState, setTokenDisplay, setScreen, setComposerFocused,
    setResumeSessions, previewRef, exitApp,
  } = ctx;

  switch (cmd.name) {
    case "auth": {
      addSystemMessage("Opening browser for OpenAI login...");
      setBusy(true);
      try {
        const result = await loginWithBrowser({ homeDir });
        setAuthStatus("connected");
        addSystemMessage(`Connected OpenAI account ${result.tokens.accountId}`);
      } catch (err) {
        addSystemMessage(`Auth failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
      break;
    }
    case "auth-codex": {
      addSystemMessage("Importing Codex CLI auth...");
      setBusy(true);
      try {
        const result = await importCodexAuth({ homeDir });
        setAuthStatus("connected");
        addSystemMessage(`Imported Codex auth for account ${result.accountId}`);
      } catch (err) {
        addSystemMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
      break;
    }
    case "auth-status": {
      const status = await getAuthStatus({ homeDir });
      if (!status.connected && !("stored" in status)) {
        addSystemMessage(status.message);
      } else {
        addSystemMessage(`Connection: ${status.connected ? "connected" : "degraded"} — ${status.message}`);
      }
      break;
    }
    case "logout": {
      await clearStoredAuth({ homeDir });
      setAuthStatus((await hasConfiguredProvider({ homeDir })) ? "connected" : "missing");
      addSystemMessage("Cleared stored account auth.");
      break;
    }
    case "init": {
      const target = process.cwd();
      setBusy(true);
      try {
        const existing = await loadWorkspaceProject(target);
        if (!existing) {
          await initWorkspace({ workspaceDir: target });
          addSystemMessage(`Workspace initialized at ${target}`);
        }
        setWorkspacePath(target);

        if (!hasAuth) {
          addSystemMessage("Add OpenAI credentials first: /auth, /config apikey <key>, or OPENAI_API_KEY.");
          break;
        }
        addSystemMessage("Scanning workspace and updating AGENTS.md...");
        const provider = await createProviderFromStoredAuth({ homeDir });
        await generateInitialAgentsMd({
          workspaceDir: target,
          provider,
          model: selectModelForTask(provider.kind, config?.defaults.model, "workspace"),
        });
        addSystemMessage("AGENTS.md ready. Project context will load on every session.");
        const scanned = await scanWorkspace(target);
        startTransition(() => setWorkspaceFiles(scanned.files));
      } catch (err) {
        addSystemMessage(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
      break;
    }
    case "skills": {
      const available = await listAvailableSkills({ homeDir });
      if (available.length === 0) {
        addSystemMessage("No skills found.");
      } else {
        for (const skill of available) {
          addSystemMessage(`${skill.name} [${skill.source}] — ${skill.description}`);
        }
      }
      break;
    }
    case "clear": {
      replaceMessages([]);
      setHistory([]);
      setActiveSkills([]);
      setPendingUpdates([]);
      setStatusLine("");
      setPlanningState({ status: "idle", planningHistory: [] });
      resetPendingQuestions();
      clearAllTasks();
      addSystemMessage("Conversation cleared.");
      break;
    }
    case "resume": {
      if (!workspacePath) { addSystemMessage("No workspace. Run /init first."); break; }
      const { listSessions } = await import("@/lib/workspace/sessions");
      const foundSessions = await listSessions(workspacePath);
      if (foundSessions.length === 0) { addSystemMessage("No previous sessions found."); break; }
      setResumeSessions(foundSessions);
      setScreen("resume");
      setComposerFocused(false);
      break;
    }
    case "config": {
      if (!args) {
        setScreen("config");
        break;
      }
      const [configKey, ...valueParts] = args.split(/\s+/);
      const configValue = valueParts.join(" ");
      if (configKey === "model") {
        const availableModels = getAvailableModels();
        if (!configValue || !availableModels.includes(configValue)) {
          addSystemMessage(`Invalid model. Options: ${availableModels.join(", ")}`);
          break;
        }
        if (config) {
          const updated = { ...config, defaults: { ...config.defaults, model: configValue } };
          setConfig(updated);
          await saveOpenResearchConfig(updated, { homeDir });
        }
        addSystemMessage(`Model set to ${configValue}.`);
      } else if (configKey === "theme") {
        if (!configValue || !(themeValues as readonly string[]).includes(configValue)) {
          addSystemMessage(`Invalid theme. Options: ${themeValues.join(", ")}`);
          break;
        }
        const newTheme = configValue as Theme;
        setTheme(newTheme);
        if (config) {
          const updated = { ...config, theme: newTheme };
          setConfig(updated);
          await saveOpenResearchConfig(updated, { homeDir });
        }
        addSystemMessage(`Theme set to ${newTheme}.`);
      } else if (configKey === "mode") {
        const validModes: AgentMode[] = ["manual-review", "auto-approve", "auto-research"];
        if (!configValue || !validModes.includes(configValue as AgentMode)) {
          addSystemMessage(`Invalid mode. Options: ${validModes.join(", ")}`);
          break;
        }
        setAgentMode(configValue as AgentMode);
        addSystemMessage(`Mode set to ${configValue}.`);
      } else if (configKey === "apikey") {
        if (!configValue) {
          const envKey = process.env.OPENAI_API_KEY;
          const configApiKey = getConfiguredOpenAIApiKey(config);
          if (envKey) {
            addSystemMessage(`OpenAI API key: ${envKey.slice(0, 7)}${"*".repeat(8)} (from OPENAI_API_KEY env var)`);
          } else if (configApiKey) {
            addSystemMessage(`OpenAI API key: ${configApiKey.slice(0, 7)}${"*".repeat(8)} (from config)`);
          } else {
            addSystemMessage("OpenAI API key: not set. Falling back to account auth when available.");
            addSystemMessage("  /config apikey sk-...  — set your key");
            addSystemMessage("  Or set OPENAI_API_KEY environment variable");
          }
          break;
        }
        if (configValue === "clear" || configValue === "remove") {
          if (config) {
            const updated = {
              ...config,
              providers: {
                ...config.providers,
                openai: { ...config.providers?.openai, apiKey: undefined },
              },
              apiKeys: { ...config.apiKeys, openai: undefined },
            };
            setConfig(updated);
            await saveOpenResearchConfig(updated, { homeDir });
          }
          setAuthStatus((await hasConfiguredProvider({ homeDir })) ? "connected" : "missing");
          addSystemMessage("OpenAI API key removed. Falling back to other available credentials.");
          break;
        }
        if (!configValue.startsWith("sk-")) {
          addSystemMessage("Invalid API key. OpenAI keys start with sk-");
          break;
        }
        if (config) {
          const updated = {
            ...config,
            providers: {
              ...config.providers,
              openai: { ...config.providers?.openai, apiKey: configValue },
            },
            apiKeys: { ...config.apiKeys, openai: undefined },
          };
          setConfig(updated);
          await saveOpenResearchConfig(updated, { homeDir });
        }
        setAuthStatus("connected");
        addSystemMessage(`OpenAI API key set: ${configValue.slice(0, 7)}${"*".repeat(8)}`);
      } else {
        addSystemMessage(`Unknown config key: ${configKey}. Available: model, theme, mode, apikey`);
      }
      break;
    }
    case "help": {
      addSystemMessage("Available commands:");
      for (const c of SLASH_COMMANDS) {
        const aliases = c.aliases.length > 0 ? ` (${c.aliases.join(", ")})` : "";
        addSystemMessage(`  /${c.name}${aliases} — ${c.description}`);
      }
      addSystemMessage("");
      addSystemMessage("Keyboard shortcuts:");
      addSystemMessage("  Shift+Tab  cycle mode (manual-review → auto-approve → auto-research)");
      addSystemMessage("  a  accept next pending update");
      addSystemMessage("  r  reject next pending update");
      addSystemMessage("  Esc  unfocus prompt");
      break;
    }
    case "compact": {
      if (history.length === 0) {
        addSystemMessage("Nothing to compact — conversation is empty.");
        break;
      }
      const customInstructions = args || undefined;
      addSystemMessage(customInstructions
        ? `Compacting conversation (preserving: ${customInstructions})...`
        : "Compacting conversation...");
      setBusy(true);
      try {
        const provider = await createProviderFromStoredAuth({ homeDir });
        const msgs = [{ role: "system" as const, content: "compaction" }, ...history.map((m) => m as any)];
        const { messages: compacted, didCompact } = await manualCompact(
          msgs, config?.defaults.model ?? "gpt-5.4", provider, sessionTokens, customInstructions
        );
        if (didCompact) {
          const newHistory = compacted.filter((m: any) => m.role !== "system").map((m: any) => ({
            role: m.role, content: m.content,
          }));
          setHistory(newHistory as any);
          const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
          setTokenDisplay(`${k(sessionTokens.estimatedCurrentTokens)} ctx · ${k(sessionTokens.totalTokens)} total`);
          addSystemMessage(`Compacted. Context reduced to ~${Math.round(sessionTokens.estimatedCurrentTokens / 1000)}k tokens.`);
        } else {
          addSystemMessage("Nothing to compact — conversation too short.");
        }
      } catch (err) {
        addSystemMessage(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
      break;
    }
    case "cost": {
      const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
      const c = sessionTokens.cumulative;
      addSystemMessage("Session token usage:");
      addSystemMessage(`  Input:     ${k(c.input)} tokens`);
      addSystemMessage(`  Output:    ${k(c.output)} tokens`);
      if (c.reasoning > 0) addSystemMessage(`  Reasoning: ${k(c.reasoning)} tokens`);
      if (c.cache.read > 0) addSystemMessage(`  Cache read:  ${k(c.cache.read)} tokens`);
      if (c.cache.write > 0) addSystemMessage(`  Cache write: ${k(c.cache.write)} tokens`);
      addSystemMessage(`  Total:     ${k(c.total)} tokens`);
      addSystemMessage(`  Context:   ~${k(sessionTokens.estimatedCurrentTokens)} (current window)`);
      addSystemMessage(`  Compactions: ${sessionTokens.compactionCount}`);
      break;
    }
    case "context": {
      const model = config?.defaults.model ?? "gpt-5.4";
      const window = getContextWindow(model);
      const threshold = getCompactThreshold(model);
      const current = sessionTokens.estimatedCurrentTokens || estimateConversationTokens(
        history.map((m) => m as any)
      );
      const pct = Math.round((current / window) * 100);
      const barWidth = 40;
      const filled = Math.round((pct / 100) * barWidth);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);
      addSystemMessage(`Context window: ${model} (${(window / 1000).toFixed(0)}k)`);
      addSystemMessage(`  [${bar}] ${pct}%`);
      addSystemMessage(`  ${(current / 1000).toFixed(1)}k / ${(window / 1000).toFixed(0)}k tokens used`);
      addSystemMessage(`  Auto-compact at ${(threshold / 1000).toFixed(0)}k (90%)`);
      if (pct > 80) {
        addSystemMessage("  Tip: run /compact to free space, or /clear to start fresh.");
      }
      break;
    }
    case "btw": {
      if (!args) {
        addSystemMessage("Usage: /btw <your side question>");
        break;
      }
      if (!hasAuth) {
        addSystemMessage("Not connected. Run /auth, set OPENAI_API_KEY, or use /config apikey <key>.");
        break;
      }
      addSystemMessage(`Side question: ${args}`);
      setBusy(true);
      try {
        const provider = await createProviderFromStoredAuth({ homeDir });
        const response = await provider.callLLM({
          messages: [
            { role: "system", content: "Answer this quick side question concisely. Do not reference any prior conversation." },
            { role: "user", content: args },
          ],
          model: config?.defaults.model ?? "gpt-5.4",
          maxTokens: 1000,
        });
        addSystemMessage(`Answer: ${response.content}`);
      } catch (err) {
        addSystemMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
      break;
    }
    case "export": {
      const fileName = args?.trim() || "conversation-export.md";
      const path = require("node:path");
      const exportPath = path.resolve(workspacePath ?? process.cwd(), fileName);
      const lines: string[] = [`# Open Research — Conversation Export\n`];
      for (const msg of messages) {
        if (msg.role === "user") lines.push(`## You\n${msg.text}\n`);
        else if (msg.role === "assistant") lines.push(`## Agent\n${msg.text}\n`);
        else lines.push(`> ${msg.text}\n`);
      }
      try {
        const fsModule = require("node:fs/promises");
        await fsModule.writeFile(exportPath, lines.join("\n"), "utf8");
        addSystemMessage(`Exported ${messages.length} messages to ${exportPath}`);
      } catch (err) {
        addSystemMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }
    case "diff": {
      if (!workspacePath) {
        addSystemMessage("No workspace active.");
        break;
      }
      try {
        const { execSync } = require("node:child_process");
        const gitStatus = execSync("git status --short 2>/dev/null || echo 'Not a git repo'", {
          cwd: workspacePath, encoding: "utf8",
        }).trim();
        if (!gitStatus || gitStatus === "Not a git repo") {
          addSystemMessage("No changes detected (not a git repo or no modifications).");
        } else {
          addSystemMessage("Changed files:");
          for (const line of gitStatus.split("\n")) {
            addSystemMessage(`  ${line}`);
          }
        }
      } catch {
        addSystemMessage("Could not check changes.");
      }
      break;
    }
    case "api-keys": {
      if (!args) {
        const ssKey = getSemanticScholarApiKey(config);
        const oaKey = getOpenAlexApiKey(config);
        addSystemMessage("API Keys:");
        addSystemMessage(`  Semantic Scholar: ${ssKey ? ssKey.slice(0, 8) + "..." : "not set"}`);
        addSystemMessage(`  OpenAlex: ${oaKey ? oaKey.slice(0, 8) + "..." : "not set"}`);
        addSystemMessage("");
        addSystemMessage("Set via CLI:");
        addSystemMessage("  /api-keys semantic-scholar YOUR_KEY");
        addSystemMessage("  /api-keys openalex YOUR_KEY");
        addSystemMessage("");
        addSystemMessage("Or set environment variables:");
        addSystemMessage("  export SEMANTIC_SCHOLAR_API_KEY=your_key");
        addSystemMessage("  export OPENALEX_API_KEY=your_key");
        break;
      }
      const [keyName, ...keyParts] = args.split(/\s+/);
      const keyValue = keyParts.join("").trim();
      if (!keyValue) {
        addSystemMessage("Usage: /api-keys <semantic-scholar|openalex> <key>");
        break;
      }
      if (config) {
        const apiKeys = config.apiKeys ?? {};
        if (keyName === "semantic-scholar" || keyName === "ss") {
          apiKeys.semanticScholar = keyValue;
        } else if (keyName === "openalex" || keyName === "oa") {
          apiKeys.openAlex = keyValue;
        } else {
          addSystemMessage(`Unknown key: ${keyName}. Use semantic-scholar or openalex.`);
          break;
        }
        const updated = { ...config, apiKeys };
        setConfig(updated);
        await saveOpenResearchConfig(updated, { homeDir });
        addSystemMessage(`${keyName} API key saved.`);
      }
      break;
    }
    case "doctor": {
      addSystemMessage("Running diagnostics...");
      const authResult = await getAuthStatus({ homeDir });
      addSystemMessage(`  Auth: ${authResult.connected ? "connected" : "not connected"} — ${authResult.message}`);
      addSystemMessage(`  Workspace: ${workspacePath ? workspacePath : "none"}`);
      addSystemMessage(`  Files: ${workspaceFiles.length}`);
      addSystemMessage(`  Skills: ${skills.length} loaded`);
      const ssKey = getSemanticScholarApiKey(config);
      const oaKey = getOpenAlexApiKey(config);
      addSystemMessage(`  Semantic Scholar API: ${ssKey ? "configured" : "not set (rate-limited)"}`);
      addSystemMessage(`  OpenAlex API: ${oaKey ? "configured" : "not set (limited)"}`);
      const mems = await loadAllMemories({ homeDir });
      addSystemMessage(`  Memories: ${mems.length} stored`);
      addSystemMessage(`  Node: ${process.version}`);
      const toolChecks = ["python3 --version", "pdflatex --version", "git --version"];
      for (const cmd of toolChecks) {
        try {
          const { execSync } = require("node:child_process");
          const out = execSync(cmd + " 2>&1", { encoding: "utf8", timeout: 3000 }).trim().split("\n")[0];
          addSystemMessage(`  ${cmd.split(" ")[0]}: ${out}`);
        } catch {
          addSystemMessage(`  ${cmd.split(" ")[0]}: not found`);
        }
      }
      addSystemMessage("Diagnostics complete.");
      break;
    }
    case "preview": {
      if (!args) {
        addSystemMessage("Usage: /preview <path-to-tex-file>");
        addSystemMessage("Example: /preview papers/draft.tex");
        break;
      }
      const texPath = args.trim();
      const pathModule = require("node:path");
      const resolvedTex = pathModule.isAbsolute(texPath) ? texPath : pathModule.resolve(workspacePath ?? process.cwd(), texPath);
      try {
        if (previewRef.current) {
          previewRef.current.close();
        }
        const preview = await startPreviewServer(resolvedTex);
        previewRef.current = preview;
        addSystemMessage(`Live preview started at ${preview.url}`);
        addSystemMessage("Auto-reloads when the file changes. Close with /preview stop");
        const openModule = await import("open");
        await openModule.default(preview.url);
      } catch (err) {
        addSystemMessage(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }
    case "memory": {
      if (args === "clear") {
        await clearMemories({ homeDir });
        addSystemMessage("All memories cleared.");
        break;
      }
      if (args.startsWith("delete ")) {
        const memId = args.slice(7).trim();
        const deleted = await deleteMemory(memId, { homeDir });
        addSystemMessage(deleted ? `Deleted memory ${memId.slice(0, 8)}...` : "Memory not found.");
        break;
      }
      const mems = await loadAllMemories({ homeDir });
      if (mems.length === 0) {
        addSystemMessage("No memories stored yet. I'll learn about you as we talk.");
      } else {
        addSystemMessage(`${mems.length} memories:`);
        for (const m of mems) {
          addSystemMessage(`  [${m.category}] ${m.content}`);
          addSystemMessage(`    id: ${m.id.slice(0, 8)}... · reinforced ${m.relevanceCount}x`);
        }
        addSystemMessage("");
        addSystemMessage("  /memory clear — delete all");
        addSystemMessage("  /memory delete <id> — delete one");
      }
      break;
    }
    case "exit": {
      exitApp();
      break;
    }
  }
}
