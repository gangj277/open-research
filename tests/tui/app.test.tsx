import React from "react";
import { describe, expect, test, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "@/tui/app";

const mockEnsureOpenResearchConfig = vi.fn(async () => ({
  version: 1,
  defaults: { model: "gpt-5.4", reasoningEffort: "medium", editPolicy: "mixed" },
  theme: "dark",
  lastWorkspace: null,
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
      {
        key: "path:artifacts/synthesis.md",
        label: "artifacts/synthesis.md",
        path: "artifacts/synthesis.md",
        content: "# Synthesis\n\nKey findings",
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
    {
      name: "methodology-critic",
      description: "Critique methodology",
      source: "builtin",
      skillDir: "/tmp/methodology-critic",
      skillFile: "/tmp/methodology-critic/SKILL.md",
    },
  ]),
}));

vi.mock("@/lib/config/store", () => ({
  ensureOpenResearchConfig: (...args: unknown[]) => mockEnsureOpenResearchConfig(...args),
  loadOpenResearchConfig: vi.fn(async () => null),
  saveOpenResearchConfig: vi.fn(async () => {}),
  getConfiguredOpenAIApiKey: (config: { providers?: { openai?: { apiKey?: string } }; apiKeys?: { openai?: string } } | null | undefined) =>
    config?.providers?.openai?.apiKey || config?.apiKeys?.openai,
  themeValues: ["dark", "light"],
}));

const mockLoadStoredAuth = vi.fn(async () => null);
vi.mock("@/lib/auth/store", () => ({
  loadStoredAuth: (...args: unknown[]) => mockLoadStoredAuth(...args),
  clearStoredAuth: vi.fn(async () => {}),
  saveStoredAuth: vi.fn(async () => ""),
}));

describe("tui first-run state", () => {
  test("shows auth bootstrap guidance when no auth is configured", () => {
    const { lastFrame } = render(
      <App
        initialState={{
          authStatus: "missing",
          workspacePath: null,
          screen: "home",
          pendingUpdates: [],
        }}
      />
    );

    expect(lastFrame()).toMatch(/connecting your openai account|connect/i);
    expect(lastFrame()).toMatch(/\/auth/i);
  });

  test("shows workspace init guidance when auth is connected but no workspace", () => {
    const { lastFrame } = render(
      <App
        initialState={{
          authStatus: "connected",
          workspacePath: null,
          screen: "home",
          pendingUpdates: [],
        }}
      />
    );

    expect(lastFrame()).toMatch(/\/init/i);
    expect(lastFrame()).toMatch(/workspace/i);
  });

  test("treats provider-configured API key as connected on boot", async () => {
    mockEnsureOpenResearchConfig.mockResolvedValueOnce({
      version: 1,
      defaults: { model: "gpt-5.4", reasoningEffort: "medium", editPolicy: "mixed" },
      theme: "dark",
      lastWorkspace: null,
      providers: {
        openai: {
          apiKey: "sk-provider-config",
        },
      },
      apiKeys: {},
    });

    const { lastFrame } = render(
      <App
        initialState={{
          authStatus: "missing",
          workspacePath: null,
          screen: "home",
          pendingUpdates: [],
        }}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toMatch(/\/init/i);
    expect(lastFrame()).not.toMatch(/browser login|type \/auth to connect/i);
  });

  test("shows ready state when auth and workspace are configured", async () => {
    mockLoadStoredAuth.mockResolvedValueOnce({ provider: "openai_auth", tokens: { access: "x", refresh: "x", expires: Date.now() + 3600_000, accountId: "acct_1" } });
    const { lastFrame } = render(
      <App
        initialState={{
          authStatus: "connected",
          workspacePath: "/tmp/research",
          screen: "home",
          pendingUpdates: [],
        }}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toMatch(/ready/i);
    expect(lastFrame()).toMatch(/\/help/i);
  });

  test("renders prompt with slash command placeholder", () => {
    const { lastFrame } = render(
      <App
        initialState={{
          authStatus: "connected",
          workspacePath: "/tmp/research",
          screen: "home",
          pendingUpdates: [],
        }}
      />
    );

    expect(lastFrame()).toMatch(/ask a question|type \/ for commands/i);
  });
});
