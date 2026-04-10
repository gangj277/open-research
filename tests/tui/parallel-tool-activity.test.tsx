import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "ink-testing-library";

const {
  runAgentTurnMock,
  createProviderMock,
  loadStoredAuthMock,
} = vi.hoisted(() => ({
  runAgentTurnMock: vi.fn(),
  createProviderMock: vi.fn(),
  loadStoredAuthMock: vi.fn(),
}));

vi.mock("@/lib/workspace/scan", () => ({
  scanWorkspace: vi.fn(async () => ({
    workspaceDir: "/tmp/research",
    files: [
      {
        key: "path:notes/brief.md",
        label: "notes/brief.md",
        path: "notes/brief.md",
        content: "# Brief\n\nResearch overview",
      },
    ],
  })),
}));

vi.mock("@/lib/skills/registry", () => ({
  listAvailableSkills: vi.fn(async () => [
    {
      name: "source-scout",
      description: "Find citation gaps",
      source: "builtin",
      skillDir: "/tmp/source-scout",
      skillFile: "/tmp/source-scout/SKILL.md",
    },
  ]),
}));

vi.mock("@/lib/config/store", () => ({
  ensureOpenResearchConfig: vi.fn(async () => ({
    version: 1,
    defaults: { model: "gpt-5.4", reasoningEffort: "medium", editPolicy: "mixed" },
    theme: "dark",
    lastWorkspace: null,
  })),
  loadOpenResearchConfig: vi.fn(async () => null),
  saveOpenResearchConfig: vi.fn(async () => {}),
  getConfiguredOpenAIApiKey: (config: { providers?: { openai?: { apiKey?: string } }; apiKeys?: { openai?: string } } | null | undefined) =>
    config?.providers?.openai?.apiKey || config?.apiKeys?.openai,
  themeValues: ["dark", "light"],
}));

vi.mock("@/lib/auth/store", () => ({
  loadStoredAuth: (...args: unknown[]) => loadStoredAuthMock(...args),
  loadGeminiAuth: vi.fn(async () => null),
  clearStoredAuth: vi.fn(async () => {}),
  saveStoredAuth: vi.fn(async () => ""),
}));

vi.mock("@/lib/llm/provider-factory", () => ({
  createProviderFromStoredAuth: (...args: unknown[]) => createProviderMock(...args),
}));

vi.mock("@/lib/agent/runtime", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurnMock(...args),
}));

vi.mock("@/lib/cli/update-check", () => ({
  checkForUpdate: vi.fn(async () => null),
}));

import { App } from "@/tui/app";

const CONNECTED_AUTH = {
  provider: "openai_auth",
  tokens: {
    access: "x",
    refresh: "x",
    expires: Date.now() + 3_600_000,
    accountId: "acct_1",
  },
};

function renderReadyApp() {
  return render(
    <App
      initialState={{
        authStatus: "connected",
        workspacePath: "/tmp/research",
        screen: "home",
        pendingUpdates: [],
      }}
    />,
    {
      stdout: { columns: 160 },
    }
  );
}

async function waitForUi(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("parallel tool activity UI", () => {
  beforeEach(() => {
    createProviderMock.mockReset();
    createProviderMock.mockResolvedValue({});
    loadStoredAuthMock.mockReset();
    loadStoredAuthMock.mockResolvedValue(CONNECTED_AUTH);
    runAgentTurnMock.mockReset();
  });

  test("shows parallel tool progress in the footer while multiple tools are active", async () => {
    let release: (() => void) | null = null;
    runAgentTurnMock.mockImplementation(async ({
      onToolActivity,
    }: {
      onToolActivity?: (activity: {
        type: "tool_start" | "tool_end";
        toolCallId: string;
        name: string;
        description?: string;
        durationMs?: number;
      }) => void;
    }) => {
      onToolActivity?.({ type: "tool_start", toolCallId: "t1", name: "read_file", description: "Reading a.ts" });
      onToolActivity?.({ type: "tool_start", toolCallId: "t2", name: "read_file", description: "Reading b.ts" });
      await waitForUi(40);
      onToolActivity?.({ type: "tool_end", toolCallId: "t1", name: "read_file", description: "Reading a.ts", durationMs: 12 });
      await waitForUi(40);
      onToolActivity?.({ type: "tool_end", toolCallId: "t2", name: "read_file", description: "Reading b.ts", durationMs: 14 });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        text: "done",
        activeSkills: [],
        proposedUpdates: [],
        searchResults: [],
        tokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCurrentTokens: 0,
          totalCachedTokens: 0,
          totalReasoningTokens: 0,
        },
      };
    });

    const { stdin, lastFrame, unmount } = renderReadyApp();
    stdin.write("hello");
    stdin.write("\r");

    await waitForUi(25);
    // With 2 parallel tools, both descriptions are shown joined
    expect(lastFrame()).toContain("Reading a.ts");
    expect(lastFrame()).toContain("Reading b.ts");

    await waitForUi(50);
    // After one completes, the remaining tool's specific description is shown
    expect(lastFrame()).toContain("Reading b.ts");

    release?.();
    await waitForUi(60);
    unmount();
  });

  test("renders multiple concurrent sub-agent indicators and removes only the completed one", async () => {
    let release: (() => void) | null = null;
    runAgentTurnMock.mockImplementation(async ({
      onSubAgentProgress,
    }: {
      onSubAgentProgress?: (progress: {
        agentId: string;
        agentType: string;
        goal: string;
        currentTool: string;
        toolCount: number;
        status: "running" | "done";
      }) => void;
    }) => {
      onSubAgentProgress?.({
        agentId: "agent-1",
        agentType: "explore",
        goal: "Inspect auth flow",
        currentTool: "Reading auth.ts",
        toolCount: 1,
        status: "running",
      });
      onSubAgentProgress?.({
        agentId: "agent-2",
        agentType: "explore",
        goal: "Inspect runtime loop",
        currentTool: "Reading runtime.ts",
        toolCount: 2,
        status: "running",
      });
      await waitForUi(40);
      onSubAgentProgress?.({
        agentId: "agent-1",
        agentType: "explore",
        goal: "Inspect auth flow",
        currentTool: "",
        toolCount: 1,
        status: "done",
      });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        text: "done",
        activeSkills: [],
        proposedUpdates: [],
        searchResults: [],
        tokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCurrentTokens: 0,
          totalCachedTokens: 0,
          totalReasoningTokens: 0,
        },
      };
    });

    const { stdin, lastFrame, unmount } = renderReadyApp();
    stdin.write("hello");
    stdin.write("\r");

    await waitForUi(25);
    expect(lastFrame()).toContain("Inspect auth flow");
    expect(lastFrame()).toContain("Inspect runtime loop");

    await waitForUi(50);
    expect(lastFrame()).not.toContain("Inspect auth flow");
    expect(lastFrame()).toContain("Inspect runtime loop");

    release?.();
    await waitForUi(60);
    unmount();
  });
});
