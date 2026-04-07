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

const CONNECTED_AUTH = {
  provider: "openai_auth",
  tokens: {
    access: "x",
    refresh: "x",
    expires: Date.now() + 3_600_000,
    accountId: "acct_1",
  },
};

const ANSI_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

class TestStdout extends EventEmitter {
  columns: number;
  rows: number;
  isTTY = true;
  frames: string[] = [];
  private lastChunk = "";

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    this.frames.push(text);
    this.lastChunk = text;
    return true;
  };

  lastFrame() {
    return this.lastChunk;
  }

  resize(columns: number, rows = this.rows) {
    this.columns = columns;
    this.rows = rows;
    this.emit("resize");
  }
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

  return stripAnsi(stdout.lastFrame()).trim();
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
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
      stdout: stdout as unknown as NodeJS.WriteStream,
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

async function waitForMatch(stdout: TestStdout, needle: string, attempts = 12) {
  for (let index = 0; index < attempts; index += 1) {
    if (latestVisibleFrame(stdout).includes(needle)) return;
    await waitForUi();
  }

  expect(latestVisibleFrame(stdout)).toContain(needle);
}

describe("tab-switch ghost render regression", () => {
  beforeEach(() => {
    createProviderMock.mockReset();
    createProviderMock.mockResolvedValue({});
    loadStoredAuthMock.mockReset();
    loadStoredAuthMock.mockResolvedValue(CONNECTED_AUTH);
    runAgentTurnMock.mockReset();
  });

  test("does not duplicate completed tool summaries after ctrl+o and resize churn", async () => {
    runAgentTurnMock.mockImplementation(async ({
      onToolActivity,
      onTextDelta,
    }: {
      onToolActivity?: (activity: {
        type: "tool_start" | "tool_end";
        toolCallId: string;
        name: string;
        description?: string;
        durationMs?: number;
      }) => void;
      onTextDelta?: (chunk: string) => void;
    }) => {
      onToolActivity?.({ type: "tool_start", toolCallId: "read-1", name: "read_file", description: "Reading alpha.ts" });
      onToolActivity?.({ type: "tool_end", toolCallId: "read-1", name: "read_file", description: "Reading alpha.ts", durationMs: 1500 });
      onToolActivity?.({ type: "tool_start", toolCallId: "read-2", name: "read_file", description: "Reading beta.ts" });
      onToolActivity?.({ type: "tool_end", toolCallId: "read-2", name: "read_file", description: "Reading beta.ts", durationMs: 2000 });
      onTextDelta?.("Finished analysis.");

      return {
        text: "Finished analysis.",
        activeSkills: [],
        proposedUpdates: [],
      };
    });

    const { stdin, stdout, unmount, cleanup } = renderReadyApp();

    stdin.write("inspect tool output");
    stdin.write("\r");

    await waitForMatch(stdout, "Read 2 files");

    for (let cycle = 0; cycle < 3; cycle += 1) {
      stdin.write("\u000f");
      await waitForUi();
      stdout.resize(48);
      await waitForUi();
      stdout.resize(72);
      await waitForUi();
    }

    const frame = latestVisibleFrame(stdout);

    expect(countOccurrences(frame, "Read 2 files")).toBe(1);
    expect(countOccurrences(frame, "Reading alpha.ts")).toBe(1);
    expect(countOccurrences(frame, "Reading beta.ts")).toBe(1);

    unmount();
    cleanup();
  });
});
