import React from "react";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render as inkRender } from "ink";

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
import { createStableInkStdout } from "@/tui/ink-stdout";

const CONNECTED_AUTH = {
  provider: "openai_auth",
  tokens: {
    access: "x",
    refresh: "x",
    expires: Date.now() + 3_600_000,
    accountId: "acct_1",
  },
};

const CLEAR_TERMINAL = "\u001b[2J\u001b[3J\u001b[H";
const ANSI_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

class TestStdout extends EventEmitter {
  columns: number;
  rows: number;
  isTTY = true;
  frames: string[] = [];

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    this.frames.push(text);
    return true;
  };
}

class TestStderr extends EventEmitter {
  write = () => true;
}

class TestStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;

  write(data: string) {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  }

  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}

  read = () => {
    const value = this.data;
    this.data = null;
    return value;
  };
}

function renderReadyApp(columns = 72, rows = 8) {
  const stdout = new TestStdout(columns, rows);
  const stderr = new TestStderr();
  const stdin = new TestStdin();
  const instance = inkRender(
    <App
      initialState={{
        authStatus: "connected",
        workspacePath: "/tmp/research",
        screen: "home",
        pendingUpdates: [],
      }}
    />,
    {
      stdout: createStableInkStdout(stdout as unknown as NodeJS.WriteStream),
      stderr: stderr as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
      patchConsole: false,
    }
  );

  return { ...instance, stdout, stdin };
}

async function waitForUi(ms = 50) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(value: string) {
  return value.replace(ANSI_PATTERN, "");
}

function latestVisibleFrame(stdout: TestStdout) {
  for (let index = stdout.frames.length - 1; index >= 0; index -= 1) {
    const visible = stripAnsi(stdout.frames[index] ?? "").trim();
    if (visible.length > 0) {
      return visible;
    }
  }

  return "";
}

async function waitForMatch(stdout: TestStdout, needle: string, attempts = 24) {
  for (let index = 0; index < attempts; index += 1) {
    if (latestVisibleFrame(stdout).includes(needle)) {
      return;
    }
    await waitForUi();
  }

  expect(latestVisibleFrame(stdout)).toContain(needle);
}

describe("auto-scroll during streaming", () => {
  beforeEach(() => {
    createProviderMock.mockReset();
    createProviderMock.mockResolvedValue({});
    loadStoredAuthMock.mockReset();
    loadStoredAuthMock.mockResolvedValue(CONNECTED_AUTH);
    runAgentTurnMock.mockReset();
  });

  test("avoids fullscreen terminal clears on follow-up streaming turns", async () => {
    const longParagraph = [
      "This first answer is long enough to build meaningful history in scrollback.",
      "It should stay below fullscreen by itself but push the second turn over the edge if we redraw everything.",
      "That gives the test a stable way to catch whole-screen clears during follow-up streaming.",
    ].join(" ");

    runAgentTurnMock
      .mockImplementationOnce(async ({ onTextDelta }: { onTextDelta?: (chunk: string) => void }) => {
        onTextDelta?.(longParagraph);
        await waitForUi(120);
        return {
          text: longParagraph,
          activeSkills: [],
          proposedUpdates: [],
        };
      })
      .mockImplementationOnce(async ({ onTextDelta }: { onTextDelta?: (chunk: string) => void }) => {
        onTextDelta?.("Short follow-up. ");
        await waitForUi(120);
        onTextDelta?.("Still streaming.");
        await waitForUi(120);
        return {
          text: "Short follow-up. Still streaming.",
          activeSkills: [],
          proposedUpdates: [],
        };
      });

    const { stdin, stdout, unmount, cleanup } = renderReadyApp(48, 20);

    stdin.write("give me a detailed answer");
    stdin.write("\r");
    await waitForMatch(stdout, "Ask a question or type / for commands");

    const baseline = stdout.frames.length;

    stdin.write("follow up");
    stdin.write("\r");
    await waitForUi(350);

    const streamedOutput = stdout.frames.slice(baseline).join("");
    expect(streamedOutput).not.toContain(CLEAR_TERMINAL);

    unmount();
    cleanup();
  });
});
