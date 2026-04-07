import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "ink-testing-library";

const {
  exitSpy,
  runAgentTurnMock,
  createProviderMock,
  loadStoredAuthMock,
} = vi.hoisted(() => ({
  exitSpy: vi.fn(),
  runAgentTurnMock: vi.fn(),
  createProviderMock: vi.fn(),
  loadStoredAuthMock: vi.fn(),
}));

vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink");
  return {
    ...actual,
    useApp: () => ({ exit: exitSpy }),
  };
});

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

describe("Ctrl+C handling", () => {
  beforeEach(() => {
    exitSpy.mockReset();
    createProviderMock.mockReset();
    createProviderMock.mockResolvedValue({});
    loadStoredAuthMock.mockReset();
    loadStoredAuthMock.mockResolvedValue(CONNECTED_AUTH);
    runAgentTurnMock.mockReset();
    runAgentTurnMock.mockResolvedValue({
      text: "Done",
      activeSkills: [],
      proposedUpdates: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows a temporary idle warning after the first Ctrl+C", async () => {
    vi.useFakeTimers();
    const { stdin, lastFrame, unmount } = renderReadyApp();
    await vi.advanceTimersByTimeAsync(1);

    stdin.write("\u0003");
    await vi.advanceTimersByTimeAsync(1);

    expect(lastFrame()).toContain("Press Ctrl+C again to exit.");
    expect(exitSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);

    expect(lastFrame()).not.toContain("Press Ctrl+C again to exit.");
    unmount();
  });

  test("exits on a second idle Ctrl+C inside the confirmation window", async () => {
    const { stdin, lastFrame, unmount } = renderReadyApp();

    stdin.write("\u0003");
    await waitForUi();

    expect(lastFrame()).toContain("Press Ctrl+C again to exit.");

    stdin.write("\u0003");
    await waitForUi();

    expect(exitSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  test("interrupts a busy agent instead of exiting", async () => {
    runAgentTurnMock.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    );

    const { stdin, lastFrame, unmount } = renderReadyApp();

    stdin.write("hello");
    stdin.write("\r");
    await waitForUi(60);

    stdin.write("\u0003");
    await waitForUi(60);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("Interrupting agent...");
    expect(lastFrame()).toContain("Agent interrupted.");
    unmount();
  });

  test("closes the config overlay instead of starting exit confirmation", async () => {
    const { stdin, lastFrame, unmount } = renderReadyApp();

    stdin.write("/config");
    stdin.write("\r");
    await waitForUi();

    expect(lastFrame()).toContain("Search settings...");

    stdin.write("\u0003");
    await waitForUi();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(lastFrame()).not.toContain("Search settings...");
    expect(lastFrame()).not.toContain("Press Ctrl+C again to exit.");
    unmount();
  });
});
