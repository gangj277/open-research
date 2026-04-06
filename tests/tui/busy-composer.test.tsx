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

async function waitForUi(ms = 40) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("busy composer drafting", () => {
  beforeEach(() => {
    createProviderMock.mockReset();
    createProviderMock.mockResolvedValue({});
    loadStoredAuthMock.mockReset();
    loadStoredAuthMock.mockResolvedValue(CONNECTED_AUTH);
    runAgentTurnMock.mockReset();
    runAgentTurnMock.mockImplementation(
      () =>
        new Promise(() => {
          // Intentionally left pending to keep the app in busy state.
        })
    );
  });

  test("keeps the composer available for drafting while the agent is busy", async () => {
    const { stdin, lastFrame, unmount } = renderReadyApp();

    stdin.write("hello");
    stdin.write("\r");
    await waitForUi(80);

    expect(lastFrame()).toContain("thinking...");
    expect(lastFrame()).not.toContain("Agent is working...");

    stdin.write("next question");
    await waitForUi();

    expect(lastFrame()).toContain("next question");

    stdin.write("\r");
    await waitForUi();

    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain("next question");
    unmount();
  });
});
