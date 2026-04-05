import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PACKAGE_NAME = "open-research";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STATE_FILE = path.join(os.homedir(), ".open-research", "update-check.json");

interface UpdateState {
  lastCheck: number;
  latestVersion: string | null;
}

async function readState(): Promise<UpdateState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { lastCheck: 0, latestVersion: null };
  }
}

async function writeState(state: UpdateState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state), "utf8");
}

function getCurrentVersion(): string {
  // Try env var first (works with npm run dev)
  if (process.env.npm_package_version) return process.env.npm_package_version;
  // Read from the installed package.json on disk
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    // Walk up from dist/cli.js to find package.json
    let dir = __dirname || path.dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 5; i++) {
      const pkgFile = path.join(dir, "package.json");
      if (fs.existsSync(pkgFile)) {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
        if (pkg.name === "open-research" && pkg.version) return pkg.version;
      }
      dir = path.dirname(dir);
    }
  } catch { /* ignore */ }
  return "0.0.0";
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Check for updates in the background. Returns a message if an update is
 * available, null otherwise. Never throws — silently fails.
 */
export async function checkForUpdate(): Promise<string | null> {
  try {
    const state = await readState();
    const now = Date.now();

    // Don't check too frequently
    if (now - state.lastCheck < CHECK_INTERVAL_MS && state.latestVersion) {
      const current = getCurrentVersion();
      if (isNewer(state.latestVersion, current)) {
        return `Update available: ${current} → ${state.latestVersion}. Run: npm update -g open-research`;
      }
      return null;
    }

    // Fetch latest version (non-blocking, with timeout)
    const latest = await fetchLatestVersion();
    await writeState({ lastCheck: now, latestVersion: latest });

    if (!latest) return null;
    const current = getCurrentVersion();
    if (isNewer(latest, current)) {
      return `Update available: ${current} → ${latest}. Run: npm update -g open-research`;
    }
    return null;
  } catch {
    return null;
  }
}
