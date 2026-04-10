import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { TreeHash, SnapshotPatch } from "./types";

const execFile = promisify(execFileCb);

const SNAPSHOT_GITIGNORE = `# Managed by open-research snapshot system
.open-research/
.git/
node_modules/
dist/
.DS_Store
*.pyc
__pycache__/
`;

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB — skip large binaries

/**
 * SnapshotEngine wraps a shadow git repo to capture workspace state at arbitrary points.
 * The shadow repo lives at .open-research/snapshots/ and uses the workspace root as its work tree.
 * It only creates tree objects (no commits), keeping overhead minimal.
 */
export class SnapshotEngine {
  private gitDir: string;
  private workTree: string;
  private initialized = false;

  constructor(workspaceDir: string) {
    this.workTree = workspaceDir;
    this.gitDir = path.join(workspaceDir, ".open-research", "snapshots", ".git");
  }

  private get env(): Record<string, string> {
    return {
      GIT_DIR: this.gitDir,
      GIT_WORK_TREE: this.workTree,
      // Suppress git advice/warnings
      GIT_TERMINAL_PROMPT: "0",
    };
  }

  private async git(args: string[], options?: { maxBuffer?: number }): Promise<string> {
    const { stdout } = await execFile("git", args, {
      env: { ...process.env, ...this.env },
      maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024, // 10MB
      cwd: this.workTree,
    });
    return stdout.trim();
  }

  /** Initialize the shadow git repo. Idempotent. */
  async init(): Promise<void> {
    if (this.initialized) return;

    const snapshotDir = path.dirname(this.gitDir);
    await fs.mkdir(snapshotDir, { recursive: true });

    try {
      // Check if already initialized
      await this.git(["rev-parse", "--git-dir"]);
      this.initialized = true;
    } catch {
      // Not initialized — create it
      await this.git(["init", "--initial-branch=main"]);

      // Configure for performance
      await this.git(["config", "core.autocrlf", "false"]);
      await this.git(["config", "core.fsmonitor", "false"]);
      await this.git(["config", "core.symlinks", "true"]);
      await this.git(["config", "gc.auto", "0"]); // We run gc manually

      this.initialized = true;
    }

    // Always update the gitignore
    const gitignorePath = path.join(path.dirname(this.gitDir), ".gitignore");
    await fs.writeFile(gitignorePath, SNAPSHOT_GITIGNORE, "utf8");

    // Copy workspace .gitignore rules into the exclude file if they exist
    const excludeDir = path.join(this.gitDir, "info");
    await fs.mkdir(excludeDir, { recursive: true });
    const excludePath = path.join(excludeDir, "exclude");
    try {
      const workspaceGitignore = await fs.readFile(
        path.join(this.workTree, ".gitignore"),
        "utf8"
      );
      await fs.writeFile(
        excludePath,
        SNAPSHOT_GITIGNORE + "\n# From workspace .gitignore\n" + workspaceGitignore,
        "utf8"
      );
    } catch {
      await fs.writeFile(excludePath, SNAPSHOT_GITIGNORE, "utf8");
    }
  }

  /**
   * Take a snapshot of the current workspace state.
   * Returns a tree hash that can be used to restore or diff later.
   */
  async track(): Promise<TreeHash> {
    await this.init();

    // Stage all changes (respecting .gitignore)
    try {
      await this.git(["add", "-A"]);
    } catch {
      // May fail on empty workspace, that's ok
    }

    // Write the index as a tree object
    const hash = await this.git(["write-tree"]);
    return hash;
  }

  /**
   * Compute which files changed between two snapshots.
   */
  async patch(from: TreeHash, to: TreeHash): Promise<SnapshotPatch> {
    await this.init();

    const result: SnapshotPatch = { added: [], modified: [], deleted: [] };

    if (from === to) return result;

    let output: string;
    try {
      output = await this.git(["diff-tree", "-r", "--name-status", "--no-renames", from, to]);
    } catch {
      return result;
    }

    if (!output) return result;

    for (const line of output.split("\n")) {
      if (!line) continue;
      const [status, ...fileParts] = line.split("\t");
      const file = fileParts.join("\t");
      if (!file) continue;

      switch (status) {
        case "A":
          result.added.push(file);
          break;
        case "M":
          result.modified.push(file);
          break;
        case "D":
          result.deleted.push(file);
          break;
      }
    }

    return result;
  }

  /**
   * Get a unified diff string between two snapshots.
   */
  async diff(from: TreeHash, to: TreeHash): Promise<string> {
    await this.init();
    if (from === to) return "";

    try {
      return await this.git(["diff", "--no-ext-diff", from, to], { maxBuffer: 50 * 1024 * 1024 });
    } catch {
      return "";
    }
  }

  /**
   * Restore the entire workspace to a snapshot state.
   */
  async restore(hash: TreeHash): Promise<void> {
    await this.init();
    await this.git(["read-tree", hash]);
    await this.git(["checkout-index", "-a", "-f"]);
  }

  /**
   * Selectively restore specific files from a snapshot.
   * Files that didn't exist in the snapshot are deleted.
   */
  async revert(hash: TreeHash, patch: SnapshotPatch): Promise<string[]> {
    await this.init();
    const restoredFiles: string[] = [];

    // Restore modified and deleted files (they existed in the snapshot)
    const filesToRestore = [...patch.modified, ...patch.deleted];
    for (const file of filesToRestore) {
      try {
        await this.git(["checkout", hash, "--", file]);
        restoredFiles.push(file);
      } catch {
        // File may not exist in the tree — skip
      }
    }

    // Delete added files (they didn't exist in the snapshot)
    for (const file of patch.added) {
      const fullPath = path.join(this.workTree, file);
      try {
        await fs.unlink(fullPath);
        restoredFiles.push(file);
      } catch {
        // Already gone — fine
      }
    }

    return restoredFiles;
  }

  /**
   * Run garbage collection to clean up old tree objects.
   */
  async gc(): Promise<void> {
    try {
      await this.init();
      await this.git(["gc", "--prune=7.days.ago", "--quiet"]);
    } catch {
      // GC failures are non-critical
    }
  }

  /** Check if the shadow repo is initialized and functional */
  async isInitialized(): Promise<boolean> {
    try {
      await this.git(["rev-parse", "--git-dir"]);
      return true;
    } catch {
      return false;
    }
  }
}
