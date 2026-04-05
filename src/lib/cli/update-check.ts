import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getPackageVersion } from "@/lib/cli/version";

const PACKAGE_NAME = "open-research";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STATE_FILE = path.join(os.homedir(), ".open-research", "update-check.json");

interface UpdateState {
  lastCheck: number;
  latestVersion: string | null;
  checkedFromVersion: string | null;
}

async function readState(): Promise<UpdateState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<UpdateState>;
    return {
      lastCheck: typeof parsed.lastCheck === "number" ? parsed.lastCheck : 0,
      latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : null,
      checkedFromVersion:
        typeof parsed.checkedFromVersion === "string" ? parsed.checkedFromVersion : null,
    };
  } catch {
    return { lastCheck: 0, latestVersion: null, checkedFromVersion: null };
  }
}

async function writeState(state: UpdateState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state), "utf8");
}

function getCurrentVersion(): string {
  return getPackageVersion();
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
    const current = getCurrentVersion();

    // Don't check too frequently
    if (
      now - state.lastCheck < CHECK_INTERVAL_MS &&
      state.latestVersion &&
      state.checkedFromVersion === current
    ) {
      if (isNewer(state.latestVersion, current)) {
        return `Update available: ${current} → ${state.latestVersion}. Run: npm update -g open-research`;
      }
      return null;
    }

    // Fetch latest version (non-blocking, with timeout)
    const latest = await fetchLatestVersion();
    await writeState({ lastCheck: now, latestVersion: latest, checkedFromVersion: current });

    if (!latest) return null;
    if (isNewer(latest, current)) {
      return `Update available: ${current} → ${latest}. Run: npm update -g open-research`;
    }
    return null;
  } catch {
    return null;
  }
}
