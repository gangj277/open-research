import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
      description: "Find citation gaps across related literature and summarize the highest-signal leads for follow-up.",
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
import { AgentMessage, FooterBar, SuggestionDropdown, type SuggestionItem } from "@/tui/components";

const CONNECTED_AUTH = {
  provider: "openai_auth",
  tokens: {
    access: "x",
    refresh: "x",
    expires: Date.now() + 3_600_000,
    accountId: "acct_1",
  },
};

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
const originalStdoutColumns = process.stdout.columns;

function stripAnsi(value: string) {
  return value.replace(ANSI_PATTERN, "");
}

function expectFrameWithinWidth(frame: string, width: number) {
  const visible = stripAnsi(frame);
  for (const line of visible.split("\n")) {
    expect(line.length, line).toBeLessThanOrEqual(width);
  }
}

function renderReadyApp(columns = 52, workspacePath = "/tmp/research-workspace-with-a-very-long-name-for-layout-checking") {
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value: columns,
  });
  return render(
    <App
      initialState={{
        authStatus: "connected",
        workspacePath,
        screen: "home",
        pendingUpdates: [],
      }}
    />,
    {
      stdout: { columns },
    }
  );
}

async function waitForUi(ms = 60) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("tui layout hardening", () => {
  beforeEach(() => {
    createProviderMock.mockReset();
    createProviderMock.mockResolvedValue({});
    loadStoredAuthMock.mockReset();
    loadStoredAuthMock.mockResolvedValue(CONNECTED_AUTH);
    runAgentTurnMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: originalStdoutColumns,
    });
  });

  test("keeps long agent output inside a narrow terminal", async () => {
    const responseText = [
      "This is a deliberately long assistant paragraph that should wrap cleanly instead of spilling past the right edge of the terminal when the viewport is narrow.",
      "",
      "```ts",
      "const explanation = 'This code fence should also stay inside the same viewport width without hardcoded forty-character borders.';",
      "```",
    ].join("\n");
    runAgentTurnMock.mockImplementation(async ({ onTextDelta }: { onTextDelta?: (chunk: string) => void }) => {
      onTextDelta?.(responseText);
      return {
        text: responseText,
        activeSkills: [],
        proposedUpdates: [],
      };
    });

    const { stdin, lastFrame, unmount } = renderReadyApp(52);

    stdin.write("layout check");
    stdin.write("\r");

    await waitForUi(160);

    expect(lastFrame()).toContain("agent");
    expectFrameWithinWidth(lastFrame(), 52);
    unmount();
  });

  test("wraps agent messages when rendered directly with a width", () => {
    const { lastFrame } = render(
      <AgentMessage
        width={52}
        text="This is a deliberately long assistant paragraph that should wrap cleanly instead of spilling past the right edge of the terminal when the viewport is narrow."
      />,
      {
        stdout: { columns: 52 },
      }
    );

    expectFrameWithinWidth(lastFrame(), 52);
  });

  test("keeps footer rows inside the supplied width", () => {
    const { lastFrame } = render(
      <FooterBar
        width={42}
        busy
        frame="◐"
        toolActivity="Comparing a very long sequence of workspace files and summarizing the most relevant results"
        toolCount={11}
        statusParts={["connected", "245 files", "manual-review", "2 pending"]}
        statusColor="yellow"
        tokenDisplay="128.4k ctx · 512.0k total"
        workspaceName="research-workspace-with-a-very-long-name"
        mode="manual-review"
        planningStatus="idle"
      />
    );

    expectFrameWithinWidth(lastFrame(), 42);
  });

  test("truncates long suggestion rows instead of overflowing", () => {
    const items: SuggestionItem[] = [
      {
        kind: "skill",
        name: "source-scout",
        description: "Find citation gaps across related literature and summarize the highest-signal follow-up opportunities for the user.",
        source: "builtin",
      },
    ];

    const { lastFrame } = render(
      <SuggestionDropdown
        width={44}
        items={items}
        selectedIndex={0}
      />
    );

    expect(stripAnsi(lastFrame())).toContain("…");
    expectFrameWithinWidth(lastFrame(), 44);
  });
});
