import path from "node:path";
import React, {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "@/tui/text-input";
import { ThemeProvider, getThemeColors } from "@/tui/theme";
import type { ProposedUpdate, AgentMode } from "@/lib/agent/state";
import type { LLMMessage } from "@/lib/llm/types";
import { scanWorkspace } from "@/lib/workspace/scan";
import { createProviderFromStoredAuth } from "@/lib/llm/provider-factory";
import { runAgentTurn } from "@/lib/agent/runtime";
import { listAvailableSkills } from "@/lib/skills/registry";
import { classifyUpdateRisk } from "@/lib/agent/review-policy";
import { applyProposedUpdate } from "@/lib/workspace/apply-update";
import { appendSessionEvent, listSessions, loadSessionHistory } from "@/lib/workspace/sessions";
import {
  ensureOpenResearchConfig,
  saveOpenResearchConfig,
  getConfiguredOpenAIApiKey,
  type OpenResearchConfig,
  type Theme,
} from "@/lib/config/store";
import { getAvailableModels } from "@/lib/llm/provider-catalog";
import { hasConfiguredProvider } from "@/lib/llm/provider-resolution";
import { ConfigScreen, type ConfigItem } from "@/tui/config-screen";
import { SessionPicker } from "@/tui/session-picker";
import { getPendingQuestion, clearPendingQuestion, type AskUserPendingQuestion } from "@/lib/agent/tools/ask-user";
import { clearCurrentTask, getCurrentTask } from "@/lib/agent/tools/current-task";
import { getPackageVersion } from "@/lib/cli/version";
import { getContextWindow } from "@/lib/agent/context-manager";
import { createSessionUsage, type SessionTokenUsage } from "@/lib/agent/context-manager";
import { checkForUpdate } from "@/lib/cli/update-check";
import type { PreviewServer } from "@/lib/preview/server";
import { themeValues } from "@/lib/config/store";
import type { SubAgentProgress } from "@/lib/agent/subagent";
import { TurnManager } from "@/lib/snapshot";
import {
  matchSlashCommand,
  getUnifiedSuggestions,
  extractAtMention,
  extractSlashTrigger,
  getFileSuggestions,
  truncate,
  type Suggestion,
  type SkillSummary,
  type WorkspaceFile,
} from "@/tui/commands";
import {
  HomeScreen as HomeScreenComponent,
  SubAgentIndicator,
  PendingUpdateCard,
  QuestionCard,
  SuggestionDropdown,
  PromptPrefix,
  FooterBar,
  ThinkingIndicator,
  ActivityFeed,
  type ActivityItem,
  type SuggestionItem,
} from "@/tui/components";
import {
  createSentenceStreamBuffer,
  type ConversationMessage,
  splitMessagesForRender,
} from "@/tui/streaming";
import { insetWidth } from "@/tui/layout";

// ── Extracted modules ──────────────────────────────────────────────────────
import { useAnimatedFrame } from "@/tui/hooks/use-animated-frame";
import { useTerminalVisibility } from "@/tui/hooks/use-terminal-visibility";
import { useTerminalWidth } from "@/tui/hooks/use-terminal-width";
import { executeSlashCommand, type SlashCommandContext } from "@/tui/hooks/use-slash-commands";
import { buildToolSummary } from "@/tui/helpers/tool-summary";
import { renderConversationMessages } from "@/tui/helpers/render-message";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AppState {
  authStatus: "missing" | "connected";
  workspacePath: string | null;
  screen: "home" | "workspace";
  pendingUpdates: ProposedUpdate[];
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
  const turnManagerRef = useRef<TurnManager | null>(null);
  const turnIndexRef = useRef(0);
  const [input, setInput] = useState("");
  const [composerFocused, setComposerFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState(initialState.authStatus);
  const [workspacePath, setWorkspacePath] = useState(initialState.workspacePath);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [history, setHistory] = useState<LLMMessage[]>([]);
  const [activeSkills, setActiveSkills] = useState<
    Array<{ id: string; name: string; description: string; prompt: string; skillDir: string }>
  >([]);
  const [pendingUpdates, setPendingUpdates] = useState(initialState.pendingUpdates);
  const [statusLine, setStatusLine] = useState("");
  const [activeToolActivities, setActiveToolActivities] = useState<Record<string, string>>({});
  const [turnToolCount, setTurnToolCount] = useState(0);
  const [latchedToolActivity, setLatchedToolActivity] = useState("");
  const [latchedToolCount, setLatchedToolCount] = useState(0);
  const [subAgentProgress, setSubAgentProgress] = useState<Record<string, SubAgentProgress>>({});
  const [toolActivityExpanded, setToolActivityExpanded] = useState(false);
  const turnToolLogRef = useRef<Array<{ name: string; description: string; durationMs?: number }>>([]);
  const [sessionTokens, setSessionTokens] = useState<SessionTokenUsage>(() => createSessionUsage());
  const [tokenDisplay, setTokenDisplay] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>("manual-review");
  const [theme, setTheme] = useState<Theme>("dark");
  const [config, setConfig] = useState<OpenResearchConfig | null>(null);
  const [cursorToEnd, setCursorToEnd] = useState(0);
  const [messageRenderVersion, setMessageRenderVersion] = useState(0);
  const [screen, setScreen] = useState<"main" | "config" | "resume">("main");
  const [resumeSessions, setResumeSessions] = useState<import("@/lib/workspace/sessions").SavedSession[]>([]);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const deferredPendingUpdates = useDeferredValue(pendingUpdates);
  const visiblePendingUpdates =
    deferredPendingUpdates.length > 0 ? deferredPendingUpdates : pendingUpdates;
  const terminalVisible = useTerminalVisibility();
  const activityFrame = useAnimatedFrame(busy);
  const terminalWidth = useTerminalWidth();
  const contentWidth = insetWidth(terminalWidth, 2);
  const panelInnerWidth = insetWidth(contentWidth, 4);
  const panelBodyWidth = insetWidth(panelInnerWidth, 2);

  const [agentQuestion, setAgentQuestion] = useState<AskUserPendingQuestion | null>(null);
  const previewRef = useRef<PreviewServer | null>(null);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalVisibleRef = useRef(terminalVisible);
  const previousTerminalVisibleRef = useRef(terminalVisible);
  const streamBufferRef = useRef<ReturnType<typeof createSentenceStreamBuffer> | null>(null);

  const isHome = messages.length === 0 && !busy;
  const { staticMessages, dynamicMessages } = useMemo(
    () => splitMessagesForRender(messages, busy),
    [busy, messages],
  );
  const staticRenderItems = useMemo(
    () => renderConversationMessages(staticMessages, toolActivityExpanded, contentWidth),
    [contentWidth, staticMessages, toolActivityExpanded],
  );
  const dynamicRenderItems = useMemo(
    () => renderConversationMessages(dynamicMessages, toolActivityExpanded, contentWidth),
    [contentWidth, dynamicMessages, toolActivityExpanded],
  );
  // Show thinking indicator when busy and agent hasn't started streaming text yet
  const showThinking = busy && (
    messages.length === 0 ||
    messages[messages.length - 1]?.role !== "assistant"
  );
  const activeToolDescriptions = useMemo(
    () => Object.values(activeToolActivities),
    [activeToolActivities],
  );
  const currentToolActivity = useMemo(() => {
    if (activeToolDescriptions.length === 0) return "";
    if (activeToolDescriptions.length === 1) return activeToolDescriptions[0] ?? "";
    if (activeToolDescriptions.length === 2) return activeToolDescriptions.join(" · ");
    return `Running ${activeToolDescriptions.length} tools in parallel`;
  }, [activeToolDescriptions]);
  useEffect(() => {
    if (!busy) {
      setLatchedToolActivity("");
      setLatchedToolCount(0);
      return;
    }

    if (!currentToolActivity) {
      return;
    }

    setLatchedToolActivity(currentToolActivity);
    setLatchedToolCount(turnToolCount);
  }, [busy, currentToolActivity, turnToolCount]);
  const visibleSubAgents = useMemo(
    () => Object.values(subAgentProgress),
    [subAgentProgress],
  );
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
        // Defocus text input — QuestionCard handles all interaction (selection + custom typing)
        setComposerFocused(false);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [busy, agentQuestion]);

  // ── Boot: check auth, load workspace ────────────────────────────────────

  useEffect(() => {
    void (async () => {
      const [cfg, storedOrDiskProviderConfigured] = await Promise.all([
        ensureOpenResearchConfig({ homeDir }),
        hasConfiguredProvider({ homeDir }),
      ]);
      const providerConfigured = Boolean(
        process.env.OPENAI_API_KEY ||
        getConfiguredOpenAIApiKey(cfg) ||
        storedOrDiskProviderConfigured
      );
      setConfig(cfg);
      setTheme(cfg.theme);
      setAuthStatus(providerConfigured ? "connected" : "missing");
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
    // Initialize snapshot system
    const tm = new TurnManager(workspacePath);
    turnManagerRef.current = tm;
    turnIndexRef.current = 0;
    void tm.init().then(() => tm.gc()).catch(() => {});
    return () => { cancelled = true; };
  }, [workspacePath, sessionId]);

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

  useEffect(() => {
    return () => {
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    terminalVisibleRef.current = terminalVisible;

    if (terminalVisible) {
      streamBufferRef.current?.flush();
    }

    if (terminalVisible && !previousTerminalVisibleRef.current) {
      setMessageRenderVersion((current) => current + 1);
    }

    previousTerminalVisibleRef.current = terminalVisible;
  }, [terminalVisible]);

  // ── Unified autocomplete (commands + skills) ────────────────────────────

  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  const atMention = useMemo(() => extractAtMention(input), [input]);
  const slashTrigger = useMemo(() => extractSlashTrigger(input), [input]);

  const suggestions = useMemo((): Suggestion[] => {
    if (atMention) {
      return getFileSuggestions(atMention.partial, workspaceFiles);
    }
    if (!slashTrigger) return [];
    return getUnifiedSuggestions(`/${slashTrigger.partial}`, skills);
  }, [input, skills, atMention, slashTrigger, workspaceFiles]);

  useEffect(() => {
    setSelectedSuggestion(-1);
  }, [suggestions.length, input]);

  const dropdownVisible = suggestions.length > 0 && input.length > 0;

  function applySuggestion(s: Suggestion): void {
    if (s.kind === "file" && atMention) {
      const before = input.slice(0, atMention.start);
      setInput(`${before}@${s.path} `);
    } else if ((s.kind === "command" || s.kind === "skill") && slashTrigger) {
      const before = input.slice(0, slashTrigger.start);
      setInput(`${before}/${s.name}`);
    }
    setSelectedSuggestion(-1);
    setCursorToEnd((c) => c + 1);
  }

  function applyAutocomplete(): boolean {
    if (suggestions.length === 0) return false;
    const idx = selectedSuggestion >= 0 ? selectedSuggestion : 0;
    const target = suggestions[idx];
    if (!target) return false;
    const exact = matchSlashCommand(input.trim());
    if (exact) return false;
    applySuggestion(target);
    return true;
  }

  function handleDropdownUp() {
    if (!dropdownVisible) return;
    setSelectedSuggestion((prev) => {
      const max = suggestions.length - 1;
      return prev <= 0 ? max : prev - 1;
    });
  }

  function handleDropdownDown() {
    if (!dropdownVisible) return;
    setSelectedSuggestion((prev) => {
      const max = suggestions.length - 1;
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

  // ── Message helpers ────────────────────────────────────────────────────

  function addSystemMessage(text: string) {
    startTransition(() => {
      setMessages((current) => [...current, { role: "system", text }]);
    });
  }

  function addAssistantMessage(text: string) {
    if (!text) return;
    startTransition(() => {
      setMessages((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") {
          next.push({ role: "assistant", text });
        } else {
          last.text += text;
        }
        return next;
      });
    });
  }

  function replaceMessages(nextMessages: ConversationMessage[]) {
    setMessages(nextMessages);
    setMessageRenderVersion((current) => current + 1);
  }

  // ── Slash command context ──────────────────────────────────────────────

  const slashCtx: SlashCommandContext = {
    homeDir, workspacePath, hasAuth, config, messages, history, skills, workspaceFiles,
    sessionId, sessionTokens, agentMode, previewRef,
    addSystemMessage, replaceMessages, setBusy, setAuthStatus, setWorkspacePath, setWorkspaceFiles,
    setConfig, setTheme, setAgentMode, setHistory, setActiveSkills, setPendingUpdates,
    setStatusLine, setTokenDisplay: setTokenDisplay,
    setScreen, setComposerFocused, setResumeSessions, exitApp: () => app.exit(),
    turnManager: turnManagerRef.current,
  };

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

  function feedbackOnPendingUpdate(feedback: string) {
    if (pendingUpdates.length === 0 || !workspacePath) return;
    const [next, ...rest] = pendingUpdates;
    void appendSessionEvent(workspacePath!, sessionId, {
      type: "update.rejected",
      timestamp: new Date().toISOString(),
      payload: { key: next.key, summary: next.summary, feedback },
    });
    startTransition(() => {
      setPendingUpdates(rest);
      addSystemMessage(`Feedback on "${next.summary}": ${feedback}`);
    });
  }

  function clearCtrlCPending() {
    if (ctrlCTimerRef.current) {
      clearTimeout(ctrlCTimerRef.current);
      ctrlCTimerRef.current = null;
    }
    setCtrlCPending(false);
  }

  function armCtrlCExitWindow() {
    if (ctrlCTimerRef.current) {
      clearTimeout(ctrlCTimerRef.current);
    }
    setCtrlCPending(true);
    ctrlCTimerRef.current = setTimeout(() => {
      ctrlCTimerRef.current = null;
      setCtrlCPending(false);
    }, 3000);
  }

  function returnToMainScreen() {
    setScreen("main");
    setComposerFocused(true);
  }

  // ── Keyboard input ────────────────────────────────────────────────────

  useInput((key, inputKey) => {
    if (inputKey.ctrl && key === "c") {
      if (busy) {
        clearCtrlCPending();
        if (abortRef.current) {
          abortRef.current.abort();
        }
        return;
      }
      if (screen !== "main") {
        clearCtrlCPending();
        returnToMainScreen();
        return;
      }
      if (ctrlCPending) {
        clearCtrlCPending();
        app.exit();
        return;
      }
      armCtrlCExitWindow();
      return;
    }

    if (ctrlCPending) {
      clearCtrlCPending();
    }

    if (inputKey.ctrl && key === "o") {
      setToolActivityExpanded((prev) => !prev);
      return;
    }
    if (inputKey.shift && inputKey.tab) {
      setAgentMode((prev) => {
        const modes: AgentMode[] = ["manual-review", "auto-approve"];
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
      } else {
        setComposerFocused(false);
      }
      return;
    }
    if (!composerFocused) {
      // When PendingUpdateCard or QuestionCard is active, let them handle all input
      if ((pendingUpdates.length > 0 && !agentQuestion) || agentQuestion) return;
      if (key === "i" || (key.length === 1 && !inputKey.ctrl && !inputKey.meta && !inputKey.tab)) {
        setComposerFocused(true);
        if (key !== "i") setInput((c) => c + key);
        return;
      }
    }
  });

  // ── Submit handler ──────────────────────────────────────────────────────

  async function handleSubmit(value: string) {
    if (handleDropdownSelect()) return;

    const trimmed = value.trim();
    if (!trimmed) return;

    // Questions are now handled entirely by QuestionCard's internal UI
    if (agentQuestion) return;

    if (busy) return;

    if (dropdownVisible && applyAutocomplete()) {
      return;
    }

    setInput("");

    const match = matchSlashCommand(trimmed);
    if (match) {
      addSystemMessage(`> ${trimmed}`);
      await executeSlashCommand(match.cmd, match.args, slashCtx);
      return;
    }

    if (trimmed.startsWith("/")) {
      const skillName = trimmed.slice(1);
      const matchedSkill = skills.find((s) => s.name === skillName);
      if (matchedSkill) {
        addSystemMessage(`> Activating skill: ${matchedSkill.name}`);
        void sendToAgent(`/skill ${matchedSkill.name}`);
        return;
      }
    }

    if (!hasAuth) {
      addSystemMessage("Not connected. Run /auth, set OPENAI_API_KEY, or use /config apikey <key>.");
      return;
    }
    if (!hasWorkspace) {
      addSystemMessage("No workspace. Run /init to initialize one in the current directory.");
      return;
    }

    void sendToAgent(trimmed);
  }

  // ── Agent execution ────────────────────────────────────────────────────

  async function sendToAgent(message: string) {
    if (!workspacePath) return;
    turnToolLogRef.current = [];
    setTurnToolCount(0);
    setLatchedToolActivity("");
    setLatchedToolCount(0);
    setActiveToolActivities({});
    setSubAgentProgress({});
    const controller = new AbortController();
    let streamBuffer: ReturnType<typeof createSentenceStreamBuffer> | null = null;
    let focusPendingReviewOnComplete = false;
    const postTurnNotices: string[] = [];
    abortRef.current = controller;
    setBusy(true);
    startTransition(() => {
      setMessages((current) => [...current, { role: "user", text: message }]);
    });

    try {
      // Snapshot: capture state before the turn
      const currentTurnIndex = turnIndexRef.current++;
      const tm = turnManagerRef.current;
      // Fire-and-forget: don't block agent turn on git operations
      tm?.beginTurn(currentTurnIndex).catch(() => {});

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
      streamBuffer = createSentenceStreamBuffer({
        onFlush: (text) => { addAssistantMessage(text); },
        isVisible: () => terminalVisibleRef.current,
      });
      streamBufferRef.current = streamBuffer;
      const result = await runAgentTurn({
        provider,
        message,
        history,
        workspace: workspaceContext,
        homeDir,
        model: config?.defaults.model,
        reasoningEffort: config?.defaults.reasoningEffort,
        activeSkills,
        signal: controller.signal,
        sessionUsage: sessionTokens,
        onTextDelta: (chunk) => {
          assistantText += chunk;
          streamBuffer?.push(chunk);
          setLatchedToolActivity("");
          setLatchedToolCount(0);
        },
        onToolActivity: (activity) => {
          streamBuffer?.flush();
          if (activity.type === "tool_start") {
            setActiveToolActivities((current) => ({
              ...current,
              [activity.toolCallId]: activity.description ?? activity.name,
            }));
          } else {
            setActiveToolActivities((current) => {
              const next = { ...current };
              delete next[activity.toolCallId];
              return next;
            });
            turnToolLogRef.current.push({
              name: activity.name,
              description: activity.description ?? activity.name,
              durationMs: activity.durationMs,
            });
            setTurnToolCount(turnToolLogRef.current.length);
            // Instant file write notification
            if (activity.name === "write_new_file" || activity.name === "update_existing_file") {
              const verb = activity.name === "write_new_file" ? "Created" : "Updated";
              addSystemMessage(`  \u25CA ${verb}: ${activity.description ?? activity.name}`);
            }
          }
        },
        onSubAgentProgress: (progress) => {
          if (progress.status === "done") {
            setSubAgentProgress((current) => {
              const next = { ...current };
              delete next[progress.agentId];
              return next;
            });
          } else {
            setSubAgentProgress((current) => ({
              ...current,
              [progress.agentId]: { ...progress },
            }));
          }
        },
        onMemoryExtracted: (mems) => {
          streamBuffer?.flush();
          for (const m of mems) {
            addSystemMessage(`  ◊ remembered: ${m}`);
          }
        },
        onCompaction: () => {
          streamBuffer?.flush();
          addSystemMessage("  \u25CA Context compacted \u2014 older messages summarized");
        },
        onTokenUpdate: (u) => {
          setSessionTokens({ ...u });
          const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
          setTokenDisplay(`${k(u.estimatedCurrentTokens)} ctx \u00B7 ${k(u.totalTokens)} total`);
        },
      });
      streamBuffer.flush();

      if (turnToolLogRef.current.length > 0) {
        const summary = buildToolSummary(turnToolLogRef.current);
        postTurnNotices.push(
          `__tool_summary__${JSON.stringify({ summary, tools: turnToolLogRef.current })}`
        );
        turnToolLogRef.current = [];
      }

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
        if (agentMode === "auto-approve") {
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
        focusPendingReviewOnComplete = true;
        setPendingUpdates((current) => [...current, ...reviewRequired]);
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

      // Snapshot: capture state after the turn (fire-and-forget)
      tm?.endTurn(currentTurnIndex).then((turnSnapshot) => {
        if (turnSnapshot && workspacePath) {
          void appendSessionEvent(workspacePath, sessionId, {
            type: "snapshot.turn",
            timestamp: new Date().toISOString(),
            payload: turnSnapshot as unknown as Record<string, unknown>,
          });
        }
      }).catch(() => {});

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
      streamBuffer?.flush();
      // Still take end snapshot on error (partial changes may have occurred via run_command)
      tm?.endTurn(currentTurnIndex).catch(() => {});
      if (!controller.signal.aborted) {
        startTransition(() => {
          setMessages((current) => [
            ...current,
            { role: "system", text: `Error: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}` },
          ]);
        });
      }
    } finally {
      streamBuffer?.dispose();
      streamBufferRef.current = null;
      abortRef.current = null;
      setActiveToolActivities({});
      setSubAgentProgress({});
      setBusy(false);
      setComposerFocused(!focusPendingReviewOnComplete);
      if (controller.signal.aborted) {
        postTurnNotices.push("Interrupting agent...\nAgent interrupted.");
      }
      for (const notice of postTurnNotices) {
        addSystemMessage(notice);
      }
      if (controller.signal.aborted) {
        return;
      }
    }
  }

  // ── Status bar ─────────────────────────────────────────────────────────

  const statusParts: string[] = [];
  if (ctrlCPending) statusParts.push("Press Ctrl+C again to exit.");
  if (hasAuth) statusParts.push("connected");
  else statusParts.push("no auth");
  if (hasWorkspace) statusParts.push(`${workspaceFiles.length} files`);
  else statusParts.push("no workspace");
  if (skills.length > 0) statusParts.push(`${skills.length} skills`);
  statusParts.push(agentMode);
  if (pendingUpdates.length > 0) statusParts.push(`${pendingUpdates.length} pending`);

  const themeColors = getThemeColors(theme);
  const statusColor = busy
    ? themeColors.warning
    : ctrlCPending
      ? themeColors.warning
      : !hasAuth
        ? themeColors.error
        : pendingUpdates.length > 0
          ? themeColors.pending
          : themeColors.secondary;

  // ── Config screen ─────────────────────────────────────────────────────

  const configItems: ConfigItem[] = useMemo(() => [
    { key: "defaults.model", label: "Model", values: [...getAvailableModels()], current: config?.defaults.model ?? "gpt-5.4" },
    { key: "theme", label: "Theme", values: [...themeValues], current: theme },
    { key: "defaults.reasoningEffort", label: "Reasoning effort", values: ["low", "medium", "high", "xhigh"], current: config?.defaults.reasoningEffort ?? "medium" },
    { key: "agentMode", label: "Agent mode", values: ["manual-review", "auto-approve"], current: agentMode },
  ], [config, theme, agentMode]);

  async function handleConfigUpdate(key: string, value: string) {
    if (key === "agentMode") { setAgentMode(value as AgentMode); return; }
    if (!config) return;
    let updated: OpenResearchConfig;
    if (key === "theme") {
      const newTheme = value as Theme;
      setTheme(newTheme);
      updated = { ...config, theme: newTheme };
    } else if (key === "defaults.model") {
      updated = { ...config, defaults: { ...config.defaults, model: value } };
    } else if (key === "defaults.reasoningEffort") {
      updated = { ...config, defaults: { ...config.defaults, reasoningEffort: value as "low" | "medium" | "high" | "xhigh" } };
    } else {
      return;
    }
    setConfig(updated);
    await saveOpenResearchConfig(updated, { homeDir });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ThemeProvider theme={theme}>
      {screen === "resume" ? (
          <SessionPicker
          sessions={resumeSessions}
          onSelect={async (session) => {
            try {
              const restored = await loadSessionHistory(workspacePath!, session.id);
              setSessionId(session.id);
              replaceMessages(restored.messages);
              startTransition(() => setHistory(restored.llmHistory));
              // Rehydrate snapshot system from persisted turn snapshots
              if (restored.turnSnapshots.length > 0 && turnManagerRef.current) {
                turnManagerRef.current.rehydrate(restored.turnSnapshots);
                turnIndexRef.current = Math.max(...restored.turnSnapshots.map((s) => s.turnIndex)) + 1;
              }
              addSystemMessage(`Resumed session (${session.turnCount} turns). Continue where you left off.`);
            } catch (err) {
              addSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            returnToMainScreen();
          }}
          onCancel={() => { returnToMainScreen(); }}
        />
      ) : screen === "config" ? (
        <ConfigScreen
          items={configItems}
          onUpdate={(key, value) => void handleConfigUpdate(key, value)}
          onClose={() => returnToMainScreen()}
        />
      ) : (
        <Box flexDirection="column" paddingX={1} paddingY={1} width={terminalWidth}>
          {isHome && (
            <HomeScreenComponent
              hasAuth={hasAuth}
              hasWorkspace={hasWorkspace}
              fileCount={workspaceFiles.length}
              skillCount={skills.length}
              version={getPackageVersion()}
              model={config?.defaults.model ?? "gpt-5.4"}
              contextWindow={getContextWindow(config?.defaults.model ?? "gpt-5.4")}
              workspacePath={workspacePath}
              width={contentWidth}
            />
          )}

          {staticRenderItems.length > 0 && (
            <Static
              key={`conversation-static-${messageRenderVersion}`}
              items={staticRenderItems}
            >
              {(item, index) => (
                <React.Fragment key={`conversation-static-item-${messageRenderVersion}-${index}`}>
                  {item}
                </React.Fragment>
              )}
            </Static>
          )}

          {dynamicRenderItems.length > 0 && (
            <Box flexDirection="column" marginBottom={1} width={contentWidth}>
              {dynamicRenderItems}
            </Box>
          )}

          {showThinking && (
            <ThinkingIndicator frame={activityFrame} width={contentWidth} currentTask={getCurrentTask() ?? undefined} />
          )}

          {busy && turnToolLogRef.current.length > 0 && (
            <ActivityFeed
              frame={activityFrame}
              width={contentWidth}
              items={[
                ...turnToolLogRef.current.map((t): ActivityItem => ({
                  description: t.description,
                  status: "done" as const,
                  durationMs: t.durationMs,
                })),
                ...Object.values(activeToolActivities).map((desc): ActivityItem => ({
                  description: desc,
                  status: "active" as const,
                })),
              ]}
            />
          )}

          {visibleSubAgents.map((progress) => (
            <SubAgentIndicator
              key={progress.agentId}
              agentType={progress.agentType}
              goal={progress.goal}
              currentTool={progress.currentTool}
              toolCount={progress.toolCount}
              recentTools={progress.recentTools}
              frame={activityFrame}
              width={contentWidth}
            />
          ))}

          {visiblePendingUpdates.length > 0 && (
            <PendingUpdateCard
              count={pendingUpdates.length}
              summary={truncate(visiblePendingUpdates[0].summary, Math.max(24, insetWidth(contentWidth, 8)))}
              fileName={visiblePendingUpdates[0].key}
              updateType={visiblePendingUpdates[0].type}
              oldContent={visiblePendingUpdates[0].oldContent}
              newContent={visiblePendingUpdates[0].content}
              active={!composerFocused && !agentQuestion}
              onAccept={() => {
                void acceptNextPendingUpdate();
                if (pendingUpdates.length <= 1) setComposerFocused(true);
              }}
              onReject={() => {
                rejectNextPendingUpdate();
                if (pendingUpdates.length <= 1) setComposerFocused(true);
              }}
              onFeedback={(fb) => {
                feedbackOnPendingUpdate(fb);
                if (pendingUpdates.length <= 1) setComposerFocused(true);
              }}
              width={contentWidth}
            />
          )}

          {dropdownVisible && (
            <SuggestionDropdown width={contentWidth} items={suggestions as SuggestionItem[]} selectedIndex={selectedSuggestion} />
          )}

          {agentQuestion && (
            <QuestionCard
              width={contentWidth}
              question={agentQuestion.question.question}
              options={agentQuestion.question.options}
              active={!composerFocused}
              onSelect={(answer, isCustom) => {
                addSystemMessage(`> ${answer}`);
                agentQuestion.resolve({ questionId: agentQuestion.question.id, answer, isCustom });
                clearPendingQuestion();
                const nextQuestion = getPendingQuestion();
                setAgentQuestion(nextQuestion);
                setComposerFocused(nextQuestion === null);
              }}
            />
          )}

          <Box borderStyle="round" borderColor={agentQuestion ? themeColors.warning : composerFocused ? themeColors.borderFocused : themeColors.borderDefault} paddingX={1} flexDirection="column" width={contentWidth}>
            <Box>
              <PromptPrefix busy={busy} frame={activityFrame} hasQuestion={!!agentQuestion} mode={agentMode} />
              <TextInput
                value={input}
                onChange={setInput}
                focus={composerFocused}
                onSubmit={(v) => void handleSubmit(v)}
                onTab={() => applyAutocomplete()}
                onUpArrow={handleDropdownUp}
                onDownArrow={handleDropdownDown}
                cursorToEnd={cursorToEnd}
                accentColor={themeColors.accent}
                mutedColor={themeColors.muted}
                placeholder={
                  agentQuestion ? "Answer in the card above"
                    : !hasAuth ? "Type /auth or /config apikey"
                    : !hasWorkspace ? "Type /init to create workspace"
                    : pendingUpdates.length > 0 && composerFocused ? "Esc to review updates, or keep drafting"
                    : busy ? "Draft your next message while the agent works"
                    : "Ask a question or type / for commands"
                }
              />
            </Box>
          </Box>

          <Box marginTop={0}>
            <Text color={themeColors.muted} dimColor={agentMode === "manual-review"}>
              {"‖ "}{agentMode}{" (shift+tab to cycle)"}
            </Text>
          </Box>

          <FooterBar
            width={contentWidth}
            busy={busy}
            frame={activityFrame}
            toolActivity={currentToolActivity || latchedToolActivity}
            toolCount={currentToolActivity ? turnToolCount : latchedToolCount}
            statusParts={statusParts}
            statusColor={statusColor}
            tokenDisplay={tokenDisplay}
            workspaceName={hasWorkspace ? path.basename(workspacePath!) : process.cwd()}
            mode={agentMode}
          />
        </Box>
      )}
    </ThemeProvider>
  );
}
