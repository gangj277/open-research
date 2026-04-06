import path from "node:path";
import React, {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "@/tui/text-input";
import type { ProposedUpdate, AgentMode, PlanningState, ResearchCharter } from "@/lib/agent/state";
import type { LLMMessage } from "@/lib/llm/types";
import { scanWorkspace } from "@/lib/workspace/scan";
import { initWorkspace, loadWorkspaceProject } from "@/lib/workspace/project";
import { createProviderFromStoredAuth } from "@/lib/llm/provider-factory";
import { runAgentTurn } from "@/lib/agent/runtime";
import { listAvailableSkills } from "@/lib/skills/registry";
import { classifyUpdateRisk } from "@/lib/agent/review-policy";
import { applyProposedUpdate } from "@/lib/workspace/apply-update";
import { appendSessionEvent, listSessions, loadSessionHistory } from "@/lib/workspace/sessions";
import { loginWithBrowser } from "@/lib/auth/login";
import { importCodexAuth } from "@/lib/auth/import-codex";
import { loadStoredAuth, clearStoredAuth } from "@/lib/auth/store";
import { getAuthStatus } from "@/lib/auth/status";
import {
  ensureOpenResearchConfig,
  loadOpenResearchConfig,
  saveOpenResearchConfig,
  themeValues,
  type OpenResearchConfig,
  type Theme,
} from "@/lib/config/store";
import { AVAILABLE_MODELS } from "@/lib/llm/model-map";
import { ConfigScreen, type ConfigItem } from "@/tui/config-screen";
import { SessionPicker } from "@/tui/session-picker";
import { getPendingQuestion, clearPendingQuestion, resetPendingQuestions, type AskUserPendingQuestion } from "@/lib/agent/tools/ask-user";
import { createSessionUsage, type SessionTokenUsage } from "@/lib/agent/context-manager";
import { checkForUpdate } from "@/lib/cli/update-check";
import { loadAllMemories, deleteMemory, clearMemories } from "@/lib/memory/store";
import { generateInitialAgentsMd } from "@/lib/workspace/init-agents-md";
import { startPreviewServer, type PreviewServer } from "@/lib/preview/server";
import {
  estimateConversationTokens,
  getContextWindow,
  getCompactThreshold,
  maybeCompact as doCompact,
  manualCompact,
} from "@/lib/agent/context-manager";
import type { ToolActivity } from "@/lib/agent/runtime";
import {
  SLASH_COMMANDS,
  matchSlashCommand,
  getUnifiedSuggestions,
  extractAtMention,
  getFileSuggestions,
  truncate,
  type SlashCommand,
  type Suggestion,
  type SkillSummary,
  type WorkspaceFile,
} from "@/tui/commands";
import {
  HomeScreen as HomeScreenComponent,
  UserMessage,
  AgentMessage,
  SystemMessage as SystemMessageComponent,
  PendingUpdateCard,
  QuestionCard,
  SuggestionDropdown,
  PromptPrefix,
  FooterBar,
  type SuggestionItem,
} from "@/tui/components";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AppState {
  authStatus: "missing" | "connected";
  workspacePath: string | null;
  screen: "home" | "workspace";
  pendingUpdates: ProposedUpdate[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

function useAnimatedFrame(active: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) { setIndex(0); return; }
    const timer = setInterval(() => setIndex((v) => (v + 1) % SPINNER_FRAMES.length), 120);
    return () => clearInterval(timer);
  }, [active]);
  return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}

function parseCharterYaml(raw: string): import("@/lib/agent/state").ResearchCharter {
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

// ── App ─────────────────────────────────────────────────────────────────────

export function App({
  initialState,
  homeDir,
}: {
  initialState: AppState;
  homeDir?: string;
}) {
  const app = useApp();
  const abortRef = useRef<AbortController | null>(null);
  const [input, setInput] = useState("");
  const [composerFocused, setComposerFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState(initialState.authStatus);
  const [workspacePath, setWorkspacePath] = useState(initialState.workspacePath);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant" | "system"; text: string }>>([]);
  const [history, setHistory] = useState<LLMMessage[]>([]);
  const [activeSkills, setActiveSkills] = useState<
    Array<{ id: string; name: string; description: string; prompt: string; skillDir: string }>
  >([]);
  const [pendingUpdates, setPendingUpdates] = useState(initialState.pendingUpdates);
  const [statusLine, setStatusLine] = useState("");
  const [currentToolActivity, setCurrentToolActivity] = useState<string>("");
  const [sessionTokens, setSessionTokens] = useState<SessionTokenUsage>(() => createSessionUsage());
  const [tokenDisplay, setTokenDisplay] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>("manual-review");
  const [planningState, setPlanningState] = useState<PlanningState>({
    status: "idle",
    planningHistory: [],
  });
  const [theme, setTheme] = useState<Theme>("dark");
  const [config, setConfig] = useState<OpenResearchConfig | null>(null);
  const [cursorToEnd, setCursorToEnd] = useState(0);
  const [screen, setScreen] = useState<"main" | "config" | "resume">("main");
  const [resumeSessions, setResumeSessions] = useState<import("@/lib/workspace/sessions").SavedSession[]>([]);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const deferredMessages = useDeferredValue(messages);
  const deferredPendingUpdates = useDeferredValue(pendingUpdates);
  const activityFrame = useAnimatedFrame(busy);

  const [agentQuestion, setAgentQuestion] = useState<AskUserPendingQuestion | null>(null);
  const previewRef = useRef<PreviewServer | null>(null);

  const isHome = deferredMessages.length === 0 && !busy;
  const hasWorkspace = workspacePath !== null;
  const hasAuth = authStatus === "connected";

  // ── Poll for agent questions ───────────────────────────────────────────
  useEffect(() => {
    if (!busy) {
      setAgentQuestion(null);
      return;
    }
    const interval = setInterval(() => {
      const pending = getPendingQuestion();
      if (pending && (!agentQuestion || pending.question.id !== agentQuestion.question.id)) {
        setAgentQuestion(pending);
        setComposerFocused(true);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [busy, agentQuestion]);

  // ── Boot: check auth, load workspace ────────────────────────────────────

  useEffect(() => {
    void (async () => {
      const cfg = await ensureOpenResearchConfig({ homeDir });
      setConfig(cfg);
      setTheme(cfg.theme);
      const auth = await loadStoredAuth({ homeDir });
      setAuthStatus(auth ? "connected" : "missing");
      // Check for updates (non-blocking)
      checkForUpdate().then((msg) => {
        if (msg) addSystemMessage(msg);
      });
    })();
  }, [homeDir]);

  useEffect(() => {
    if (!workspacePath) return;
    let cancelled = false;
    void scanWorkspace(workspacePath).then((result) => {
      if (cancelled) return;
      startTransition(() => setWorkspaceFiles(result.files));
    });
    return () => { cancelled = true; };
  }, [workspacePath]);

  useEffect(() => {
    let cancelled = false;
    void listAvailableSkills({ homeDir }).then((available) => {
      if (cancelled) return;
      startTransition(() =>
        setSkills(available.map((s) => ({ name: s.name, description: s.description, source: s.source })))
      );
    });
    return () => { cancelled = true; };
  }, [homeDir]);

  // ── Unified autocomplete (commands + skills) ────────────────────────────

  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  const atMention = useMemo(() => extractAtMention(input), [input]);

  const suggestions = useMemo((): Suggestion[] => {
    // @ file mention trigger
    if (atMention) {
      return getFileSuggestions(atMention.partial, workspaceFiles);
    }
    // / command trigger
    if (!input.startsWith("/") || input.includes(" ")) return [];
    return getUnifiedSuggestions(input, skills);
  }, [input, skills, atMention, workspaceFiles]);

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedSuggestion(-1);
  }, [suggestions.length, input]);

  const dropdownVisible = suggestions.length > 0 && input.length > 0;

  function applySuggestion(s: Suggestion): void {
    if (s.kind === "file" && atMention) {
      // Replace @partial with @path, preserving text before and after
      const before = input.slice(0, atMention.start);
      setInput(`${before}@${s.path} `);
    } else if (s.kind === "command" || s.kind === "skill") {
      setInput(`/${s.name}`);
    }
    setSelectedSuggestion(-1);
    setCursorToEnd((c) => c + 1);
  }

  function applyAutocomplete(): boolean {
    if (suggestions.length === 0) return false;
    const idx = selectedSuggestion >= 0 ? selectedSuggestion : 0;
    const target = suggestions[idx];
    if (!target) return false;
    // Don't autocomplete if already an exact command match
    const exact = matchSlashCommand(input.trim());
    if (exact) return false;
    applySuggestion(target);
    return true;
  }

  function handleDropdownUp() {
    if (!dropdownVisible) return;
    setSelectedSuggestion((prev) => {
      const max = Math.min(suggestions.length, 8) - 1;
      return prev <= 0 ? max : prev - 1;
    });
  }

  function handleDropdownDown() {
    if (!dropdownVisible) return;
    setSelectedSuggestion((prev) => {
      const max = Math.min(suggestions.length, 8) - 1;
      return prev >= max ? 0 : prev + 1;
    });
  }

  function handleDropdownSelect(): boolean {
    if (!dropdownVisible || selectedSuggestion < 0) return false;
    const target = suggestions[selectedSuggestion];
    if (!target) return false;
    applySuggestion(target);
    return true;
  }

  // ── Slash command execution ─────────────────────────────────────────────

  async function executeSlashCommand(cmd: SlashCommand, args: string) {
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
        setAuthStatus("missing");
        addSystemMessage("Cleared stored auth.");
        break;
      }
      case "init": {
        const target = process.cwd();
        setBusy(true);
        try {
          // Create workspace if needed
          const existing = await loadWorkspaceProject(target);
          if (!existing) {
            await initWorkspace({ workspaceDir: target });
            addSystemMessage(`Workspace initialized at ${target}`);
          }
          setWorkspacePath(target);

          // Always scan + generate/update AGENTS.md
          if (!hasAuth) {
            addSystemMessage("Run /auth first — AGENTS.md generation requires auth.");
            break;
          }
          addSystemMessage("Scanning workspace and updating AGENTS.md...");
          const provider = await createProviderFromStoredAuth({ homeDir });
          const result = await generateInitialAgentsMd({
            workspaceDir: target,
            provider,
            model: "gpt-5.4-mini",
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
        setMessages([]);
        setHistory([]);
        setActiveSkills([]);
        setPendingUpdates([]);
        setStatusLine("");
        setPlanningState({ status: "idle", planningHistory: [] });
        resetPendingQuestions();
        addSystemMessage("Conversation cleared.");
        break;
      }
      case "resume": {
        if (!workspacePath) { addSystemMessage("No workspace. Run /init first."); break; }
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
          if (!configValue || !(AVAILABLE_MODELS as readonly string[]).includes(configValue)) {
            addSystemMessage(`Invalid model. Options: ${AVAILABLE_MODELS.join(", ")}`);
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
        } else {
          addSystemMessage(`Unknown config key: ${configKey}. Available: model, theme, mode`);
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
        const color = pct > 90 ? "red" : pct > 70 ? "yellow" : "green";
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
          addSystemMessage("Not connected. Run /auth first.");
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
        const exportPath = require("node:path").resolve(workspacePath ?? process.cwd(), fileName);
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
      case "doctor": {
        addSystemMessage("Running diagnostics...");
        // Auth
        const authResult = await getAuthStatus({ homeDir });
        addSystemMessage(`  Auth: ${authResult.connected ? "connected" : "not connected"} — ${authResult.message}`);
        // Workspace
        addSystemMessage(`  Workspace: ${workspacePath ? workspacePath : "none"}`);
        addSystemMessage(`  Files: ${workspaceFiles.length}`);
        // Skills
        addSystemMessage(`  Skills: ${skills.length} loaded`);
        // Memory
        const mems = await loadAllMemories({ homeDir });
        addSystemMessage(`  Memories: ${mems.length} stored`);
        // Node
        addSystemMessage(`  Node: ${process.version}`);
        // Tools check
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
        const resolvedTex = require("node:path").isAbsolute(texPath) ? texPath : require("node:path").resolve(workspacePath ?? process.cwd(), texPath);
        try {
          // Close existing preview if any
          if (previewRef.current) {
            previewRef.current.close();
          }
          const preview = await startPreviewServer(resolvedTex);
          previewRef.current = preview;
          addSystemMessage(`Live preview started at ${preview.url}`);
          addSystemMessage("Auto-reloads when the file changes. Close with /preview stop");
          // Open in browser
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
        app.exit();
        break;
      }
    }
  }

  function addSystemMessage(text: string) {
    startTransition(() => {
      setMessages((current) => [...current, { role: "system", text }]);
    });
  }

  // ── Pending update review ───────────────────────────────────────────────

  async function acceptNextPendingUpdate() {
    if (pendingUpdates.length === 0 || !workspacePath) return;
    const [next, ...rest] = pendingUpdates;
    await applyProposedUpdate(workspacePath, next);
    await appendSessionEvent(workspacePath, sessionId, {
      type: "update.accepted",
      timestamp: new Date().toISOString(),
      payload: { key: next.key, summary: next.summary },
    });
    startTransition(() => {
      setPendingUpdates(rest);
      addSystemMessage(`Applied: ${next.summary}`);
    });
    const refreshed = await scanWorkspace(workspacePath);
    startTransition(() => setWorkspaceFiles(refreshed.files));
  }

  function rejectNextPendingUpdate() {
    if (pendingUpdates.length === 0 || !workspacePath) return;
    const [next, ...rest] = pendingUpdates;
    void appendSessionEvent(workspacePath!, sessionId, {
      type: "update.rejected",
      timestamp: new Date().toISOString(),
      payload: { key: next.key, summary: next.summary },
    });
    startTransition(() => {
      setPendingUpdates(rest);
      addSystemMessage(`Rejected: ${next.summary}`);
    });
  }

  // ── Keyboard input ────────────────────────────────────────────────────

  useInput((key, inputKey) => {
    // Shift+Tab cycles agent mode
    if (inputKey.shift && inputKey.tab) {
      setAgentMode((prev) => {
        const modes: AgentMode[] = ["manual-review", "auto-approve", "auto-research"];
        const idx = (modes.indexOf(prev) + 1) % modes.length;
        const next = modes[idx]!;
        addSystemMessage(`Mode: ${next} (shift+tab to cycle)`);
        return next;
      });
      return;
    }
    if (inputKey.escape) {
      if (busy && abortRef.current) {
        abortRef.current.abort();
        addSystemMessage("Interrupting agent...");
      } else if (planningState.status === "charter-review") {
        rejectCharter();
      } else {
        setComposerFocused(false);
      }
      return;
    }
    if (!composerFocused) {
      // Charter review shortcuts
      if (planningState.status === "charter-review") {
        if (key === "a") {
          void approveCharter();
          return;
        }
        if (key === "p") {
          setPlanningState((prev) => ({ ...prev, status: "planning" }));
          setComposerFocused(true);
          addSystemMessage("Continue planning — type your feedback to refine the charter.");
          return;
        }
      }
      if (key === "a" && pendingUpdates.length > 0) {
        void acceptNextPendingUpdate();
        return;
      }
      if (key === "r" && pendingUpdates.length > 0) {
        rejectNextPendingUpdate();
        return;
      }
      if (key === "i" || (key.length === 1 && !inputKey.ctrl && !inputKey.meta && !inputKey.tab)) {
        setComposerFocused(true);
        if (key !== "i") setInput((c) => c + key);
        return;
      }
    }
  });

  // ── Submit handler ──────────────────────────────────────────────────────

  async function handleSubmit(value: string) {
    // If a dropdown item is highlighted, select it instead of submitting
    if (handleDropdownSelect()) return;

    const trimmed = value.trim();
    if (!trimmed) return;

    // ── Answer a pending agent question ──────────────────────────────────
    if (agentQuestion) {
      const options = agentQuestion.question.options;
      // Check if user typed a number to pick an option
      const numChoice = parseInt(trimmed, 10);
      if (!isNaN(numChoice) && numChoice >= 1 && numChoice <= options.length) {
        const picked = options[numChoice - 1];
        addSystemMessage(`> ${picked.label}`);
        agentQuestion.resolve({
          questionId: agentQuestion.question.id,
          answer: picked.label,
          isCustom: false,
        });
      } else {
        // Custom answer
        addSystemMessage(`> ${trimmed}`);
        agentQuestion.resolve({
          questionId: agentQuestion.question.id,
          answer: trimmed,
          isCustom: true,
        });
      }
      clearPendingQuestion();
      setAgentQuestion(null);
      setInput("");
      return;
    }

    if (busy) return;

    // If typing a partial slash command, autocomplete instead of submitting
    if (trimmed.startsWith("/") && !trimmed.includes(" ") && applyAutocomplete()) {
      return;
    }

    setInput("");

    // Slash command?
    const match = matchSlashCommand(trimmed);
    if (match) {
      addSystemMessage(`> ${trimmed}`);
      await executeSlashCommand(match.cmd, match.args);
      return;
    }

    // Skill shorthand: /source-scout → activate skill via agent
    if (trimmed.startsWith("/")) {
      const skillName = trimmed.slice(1);
      const matchedSkill = skills.find((s) => s.name === skillName);
      if (matchedSkill) {
        addSystemMessage(`> Activating skill: ${matchedSkill.name}`);
        void sendToAgent(`/skill ${matchedSkill.name}`);
        return;
      }
    }

    // Guard: need auth
    if (!hasAuth) {
      addSystemMessage("Not connected. Run /auth to connect your OpenAI account first.");
      return;
    }

    // Guard: need workspace
    if (!hasWorkspace) {
      addSystemMessage("No workspace. Run /init to initialize one in the current directory.");
      return;
    }

    // Auto-research mode: route to planning flow
    if (agentMode === "auto-research") {
      if (planningState.status === "charter-review") {
        // User is providing feedback on the charter
        addSystemMessage(`> ${trimmed}`);
        setPlanningState((prev) => ({ ...prev, status: "planning" }));
        void sendToPlanningAgent(trimmed);
        return;
      }
      // Start or continue planning
      void sendToPlanningAgent(trimmed);
      return;
    }

    void sendToAgent(trimmed);
  }

  async function sendToAgent(message: string) {
    if (!workspacePath) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setComposerFocused(false);
    startTransition(() => {
      setMessages((current) => [...current, { role: "user", text: message }]);
    });

    try {
      const provider = await createProviderFromStoredAuth({ homeDir });
      const workspace = await scanWorkspace(workspacePath);
      const workspaceContext = {
        workspaceDir: workspacePath!,
        runId: sessionId,
        workspaceFiles: Object.fromEntries(workspace.files.map((f) => [f.key, f.content])),
        availableKeys: workspace.files.map((f) => f.key),
        fileLabels: Object.fromEntries(workspace.files.map((f) => [f.key, f.label])),
      };

      let assistantText = "";
      const result = await runAgentTurn({
        provider,
        message,
        history,
        workspace: workspaceContext,
        homeDir,
        model: config?.defaults.model,
        activeSkills,
        signal: controller.signal,
        sessionUsage: sessionTokens,
        onTextDelta: (chunk) => {
          assistantText += chunk;
          startTransition(() => {
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") {
                next.push({ role: "assistant", text: chunk });
              } else {
                last.text += chunk;
              }
              return next;
            });
          });
        },
        onToolActivity: (activity) => {
          if (activity.type === "tool_start") {
            setCurrentToolActivity(activity.description ?? activity.name);
          } else {
            const dur = activity.durationMs ? ` (${(activity.durationMs / 1000).toFixed(1)}s)` : "";
            setCurrentToolActivity("");
            addSystemMessage(`  \u2713 ${activity.description ?? activity.name}${dur}`);
          }
        },
        onMemoryExtracted: (mems) => {
          for (const m of mems) {
            addSystemMessage(`  ◊ remembered: ${m}`);
          }
        },
        onCompaction: () => {
          addSystemMessage("  \u25CA Context compacted \u2014 older messages summarized");
        },
        onTokenUpdate: (u) => {
          setSessionTokens({ ...u });
          const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
          setTokenDisplay(`${k(u.estimatedCurrentTokens)} ctx \u00B7 ${k(u.totalTokens)} total`);
        },
      });

      startTransition(() => {
        setActiveSkills(result.activeSkills);
        setHistory((current) => [
          ...current,
          { role: "user", content: message },
          { role: "assistant", content: assistantText || result.text },
        ]);
      });

      const reviewRequired: ProposedUpdate[] = [];
      for (const update of result.proposedUpdates) {
        if (agentMode === "auto-approve" || agentMode === "auto-research") {
          await applyProposedUpdate(workspacePath, update);
        } else {
          const policy = classifyUpdateRisk(update);
          if (policy.policy === "auto-apply") {
            await applyProposedUpdate(workspacePath, update);
          } else {
            reviewRequired.push(update);
          }
        }
      }

      if (reviewRequired.length > 0) {
        startTransition(() => setPendingUpdates((c) => [...c, ...reviewRequired]));
      }

      await appendSessionEvent(workspacePath, sessionId, {
        type: "chat.turn",
        timestamp: new Date().toISOString(),
        payload: {
          prompt: message,
          response: assistantText || result.text,
          proposedUpdates: result.proposedUpdates.map((u) => ({ key: u.key, summary: u.summary })),
        },
      });

      const refreshed = await scanWorkspace(workspacePath);
      startTransition(() => {
        setWorkspaceFiles(refreshed.files);
        setStatusLine(
          reviewRequired.length > 0
            ? `${reviewRequired.length} update(s) moved to review`
            : "Turn complete"
        );
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        startTransition(() => {
          setMessages((current) => [
            ...current,
            { role: "system", text: `Error: ${error instanceof Error ? error.message : String(error)}` },
          ]);
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setComposerFocused(true);
      if (controller.signal.aborted) {
        addSystemMessage("Agent interrupted.");
      }
    }
  }

  // ── Planning agent (auto-research mode) ─────────────────────────────────

  async function sendToPlanningAgent(message: string) {
    if (!workspacePath) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setComposerFocused(false);

    setPlanningState((prev) => {
      if (prev.status === "idle") {
        addSystemMessage("Starting auto-research planning...");
        return { ...prev, status: "planning" };
      }
      return prev;
    });

    startTransition(() => {
      setMessages((current) => [...current, { role: "user", text: message }]);
    });

    try {
      const provider = await createProviderFromStoredAuth({ homeDir });
      const workspace = await scanWorkspace(workspacePath);
      const workspaceContext = {
        workspaceDir: workspacePath!,
        runId: sessionId,
        workspaceFiles: Object.fromEntries(workspace.files.map((f) => [f.key, f.content])),
        availableKeys: workspace.files.map((f) => f.key),
        fileLabels: Object.fromEntries(workspace.files.map((f) => [f.key, f.label])),
      };

      let assistantText = "";
      const result = await runAgentTurn({
        provider,
        message,
        history: planningState.planningHistory,
        workspace: workspaceContext,
        homeDir,
        model: config?.defaults.model,
        mode: "planning",
        activeSkills,
        signal: controller.signal,
        onTextDelta: (chunk) => {
          assistantText += chunk;
          startTransition(() => {
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") {
                next.push({ role: "assistant", text: chunk });
              } else {
                last.text += chunk;
              }
              return next;
            });
          });
        },
      });

      // Update planning history
      setPlanningState((prev) => ({
        ...prev,
        planningHistory: [
          ...prev.planningHistory,
          { role: "user" as const, content: message },
          { role: "assistant" as const, content: assistantText || result.text },
        ],
      }));

      // Check if charter was detected
      if (result.detectedCharter) {
        const charter = parseCharterYaml(result.detectedCharter);
        setPlanningState((prev) => ({
          ...prev,
          status: "charter-review",
          charter,
        }));

        if (workspacePath) {
          await appendSessionEvent(workspacePath, sessionId, {
            type: "charter.generated",
            timestamp: new Date().toISOString(),
            payload: { charterId: charter.id, researchQuestion: charter.researchQuestion },
          });
        }
      }

      startTransition(() => {
        setActiveSkills(result.activeSkills);
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        startTransition(() => {
          setMessages((current) => [
            ...current,
            { role: "system", text: `Error: ${error instanceof Error ? error.message : String(error)}` },
          ]);
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setComposerFocused(true);
      if (controller.signal.aborted) {
        setPlanningState((prev) => ({ ...prev, status: "idle" }));
        addSystemMessage("Planning interrupted.");
      }
    }
  }

  async function approveCharter() {
    if (!planningState.charter || !workspacePath) return;
    const charter = planningState.charter;

    const charterContent = [
      `# Research Charter`,
      "",
      `## Research Question`,
      charter.researchQuestion,
      "",
      `## Success Criteria`,
      ...charter.successCriteria.map((c) => `- ${c}`),
      "",
      `## Scope Boundaries`,
      ...charter.scopeBoundaries.map((b) => `- ${b}`),
      "",
      `## Known Starting Points`,
      ...charter.knownStartingPoints.map((s) => `- ${s}`),
      "",
      `## Proposed Steps`,
      ...charter.proposedSteps.map((s, i) => `${i + 1}. ${s}`),
      "",
      `---`,
      `Created: ${charter.createdAt}`,
    ].join("\n");

    const charterUpdate: ProposedUpdate = {
      id: charter.id,
      type: "new",
      key: `path:artifacts/research-charter-${charter.id.slice(0, 8)}.md`,
      label: "Research Charter",
      content: charterContent,
      summary: `Research charter: ${charter.researchQuestion}`,
    };

    await applyProposedUpdate(workspacePath, charterUpdate);
    await appendSessionEvent(workspacePath, sessionId, {
      type: "charter.approved",
      timestamp: new Date().toISOString(),
      payload: { charterId: charter.id },
    });

    const refreshed = await scanWorkspace(workspacePath);
    startTransition(() => setWorkspaceFiles(refreshed.files));

    addSystemMessage("Charter approved and saved to workspace.");
    addSystemMessage("RALPH loop ready. (Implementation coming soon — for now, use regular chat to continue research based on the charter.)");
    setPlanningState((prev) => ({ ...prev, status: "idle" }));
  }

  function rejectCharter() {
    if (!planningState.charter || !workspacePath) return;
    void appendSessionEvent(workspacePath, sessionId, {
      type: "charter.rejected",
      timestamp: new Date().toISOString(),
      payload: { charterId: planningState.charter.id },
    });
    setPlanningState({ status: "idle", planningHistory: [] });
    addSystemMessage("Charter cancelled. Planning reset.");
  }

  // ── Status bar text ─────────────────────────────────────────────────────

  const statusParts: string[] = [];
  if (hasAuth) statusParts.push("connected");
  else statusParts.push("no auth");
  if (hasWorkspace) statusParts.push(`${workspaceFiles.length} files`);
  else statusParts.push("no workspace");
  if (skills.length > 0) statusParts.push(`${skills.length} skills`);
  statusParts.push(agentMode);
  if (deferredPendingUpdates.length > 0) statusParts.push(`${deferredPendingUpdates.length} pending`);

  const statusColor = busy ? "yellow" : !hasAuth ? "red" : deferredPendingUpdates.length > 0 ? "magenta" : "green";

  // ── Config screen ─────────────────────────────────────────────────────────

  const configItems: ConfigItem[] = useMemo(() => [
    {
      key: "defaults.model",
      label: "Model",
      values: [...AVAILABLE_MODELS],
      current: config?.defaults.model ?? "gpt-5.4",
    },
    {
      key: "theme",
      label: "Theme",
      values: [...themeValues],
      current: theme,
    },
    {
      key: "defaults.reasoningEffort",
      label: "Reasoning effort",
      values: ["low", "medium", "high"],
      current: config?.defaults.reasoningEffort ?? "medium",
    },
    {
      key: "agentMode",
      label: "Agent mode",
      values: ["manual-review", "auto-approve", "auto-research"],
      current: agentMode,
    },
  ], [config, theme, agentMode]);

  async function handleConfigUpdate(key: string, value: string) {
    if (key === "agentMode") {
      setAgentMode(value as AgentMode);
      return;
    }
    if (!config) return;
    let updated: OpenResearchConfig;
    if (key === "theme") {
      const newTheme = value as Theme;
      setTheme(newTheme);
      updated = { ...config, theme: newTheme };
    } else if (key === "defaults.model") {
      updated = { ...config, defaults: { ...config.defaults, model: value } };
    } else if (key === "defaults.reasoningEffort") {
      updated = {
        ...config,
        defaults: {
          ...config.defaults,
          reasoningEffort: value as "low" | "medium" | "high",
        },
      };
    } else {
      return;
    }
    setConfig(updated);
    await saveOpenResearchConfig(updated, { homeDir });
  }

  function handleConfigClose() {
    setScreen("main");
    setComposerFocused(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (screen === "resume") {
    return (
      <SessionPicker
        sessions={resumeSessions}
        onSelect={async (session) => {
          try {
            const restored = await loadSessionHistory(workspacePath!, session.id);
            startTransition(() => {
              setMessages(restored.messages);
              setHistory(restored.llmHistory);
            });
            addSystemMessage(`Resumed session (${session.turnCount} turns). Continue where you left off.`);
          } catch (err) {
            addSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          setScreen("main");
          setComposerFocused(true);
        }}
        onCancel={() => {
          setScreen("main");
          setComposerFocused(true);
        }}
      />
    );
  }

  if (screen === "config") {
    return (
      <ConfigScreen
        items={configItems}
        onUpdate={(key, value) => void handleConfigUpdate(key, value)}
        onClose={handleConfigClose}
      />
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Home screen */}
      {isHome && (
        <HomeScreenComponent
          hasAuth={hasAuth}
          hasWorkspace={hasWorkspace}
          fileCount={workspaceFiles.length}
          skillCount={skills.length}
        />
      )}

      {/* Conversation messages */}
      {deferredMessages.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {deferredMessages.slice(-30).map((msg, idx) => {
            if (msg.role === "system") {
              return <SystemMessageComponent key={`msg-${idx}`} text={msg.text} />;
            }
            if (msg.role === "user") {
              return <UserMessage key={`msg-${idx}`} text={msg.text} />;
            }
            return <AgentMessage key={`msg-${idx}`} text={msg.text} />;
          })}
        </Box>
      )}

      {/* Pending updates */}
      {deferredPendingUpdates.length > 0 && (
        <PendingUpdateCard
          count={deferredPendingUpdates.length}
          summary={truncate(deferredPendingUpdates[0].summary, 80)}
        />
      )}

      {/* Charter review panel */}
      {planningState.status === "charter-review" && planningState.charter && (
        <Box
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          marginBottom={1}
          flexDirection="column"
        >
          <Text bold color="yellow">Research Charter — Review</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold color="white">Question: </Text>
            <Text>{planningState.charter.researchQuestion}</Text>
          </Box>
          {planningState.charter.successCriteria.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold color="white">Success Criteria:</Text>
              {planningState.charter.successCriteria.map((c, i) => (
                <Text key={`sc-${i}`} color="gray">  - {c}</Text>
              ))}
            </Box>
          )}
          {planningState.charter.scopeBoundaries.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold color="white">Scope Boundaries:</Text>
              {planningState.charter.scopeBoundaries.map((b, i) => (
                <Text key={`sb-${i}`} color="gray">  - {b}</Text>
              ))}
            </Box>
          )}
          {planningState.charter.proposedSteps.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold color="white">Proposed Steps:</Text>
              {planningState.charter.proposedSteps.map((s, i) => (
                <Text key={`ps-${i}`} color="gray">  {i + 1}. {s}</Text>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Press <Text bold color="green">a</Text> to approve · <Text bold color="cyan">p</Text> to keep planning · <Text bold color="red">Esc</Text> to cancel
            </Text>
          </Box>
        </Box>
      )}

      {/* Autocomplete dropdown */}
      {dropdownVisible && (
        <SuggestionDropdown
          items={suggestions as SuggestionItem[]}
          selectedIndex={selectedSuggestion}
        />
      )}

      {/* Agent question */}
      {agentQuestion && (
        <QuestionCard
          question={agentQuestion.question.question}
          options={agentQuestion.question.options}
        />
      )}

      {/* Prompt */}
      <Box
        borderStyle="round"
        borderColor={agentQuestion ? "yellow" : busy ? "yellow" : composerFocused ? "cyan" : "gray"}
        paddingX={1}
        flexDirection="column"
      >
        <Box>
          <PromptPrefix
            busy={busy}
            frame={activityFrame}
            hasQuestion={!!agentQuestion}
            mode={agentMode}
          />
          <TextInput
            value={input}
            onChange={setInput}
            focus={composerFocused}
            onSubmit={(v) => void handleSubmit(v)}
            onTab={() => applyAutocomplete()}
            onUpArrow={handleDropdownUp}
            onDownArrow={handleDropdownDown}
            cursorToEnd={cursorToEnd}
            placeholder={
              agentQuestion
                ? "Type your answer..."
                : busy
                  ? "Agent is working..."
                  : !hasAuth
                    ? "Type /auth to connect"
                    : !hasWorkspace
                      ? "Type /init to create workspace"
                      : "Ask a question or type / for commands"
            }
          />
        </Box>
      </Box>

      {/* Mode indicator */}
      <Box marginTop={0}>
        <Text color={agentMode === "auto-research" ? "yellow" : "gray"} dimColor={agentMode === "manual-review"}>
          {"‖ "}{agentMode}{planningState.status !== "idle" ? ` (${planningState.status})` : ""}{" (shift+tab to cycle)"}
        </Text>
      </Box>

      {/* Footer */}
      <FooterBar
        busy={busy}
        frame={activityFrame}
        toolActivity={currentToolActivity}
        statusParts={statusParts}
        statusColor={statusColor}
        tokenDisplay={tokenDisplay}
        workspaceName={hasWorkspace ? path.basename(workspacePath!) : process.cwd()}
        mode={agentMode}
        planningStatus={planningState.status}
      />
    </Box>
  );
}
