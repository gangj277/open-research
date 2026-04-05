import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const MAX_TIMEOUT_MS = 10 * 60 * 1000;    // 10 minutes
const MAX_OUTPUT_BYTES = 50 * 1024;        // 50 KB per stream returned to LLM

/**
 * Execute a shell command and return stdout + stderr (labeled separately).
 * Supports timeout, abort signal, output truncation, workdir validation.
 */
export async function executeRunCommand(
  args: {
    command: string;
    workdir?: string;
    timeout?: number;
    description?: string;
  },
  signal?: AbortSignal
): Promise<string> {
  const command = args.command;
  if (!command.trim()) {
    return "Error: command is required.";
  }

  // Resolve and validate workdir
  const workdir = args.workdir
    ? (path.isAbsolute(args.workdir) ? args.workdir : path.resolve(args.workdir))
    : process.cwd();

  try {
    const stat = await fs.stat(workdir);
    if (!stat.isDirectory()) {
      return `Error: workdir is not a directory: ${workdir}`;
    }
  } catch {
    return `Error: workdir does not exist: ${workdir}`;
  }

  const timeout = Math.min(
    Math.max(args.timeout ?? DEFAULT_TIMEOUT_MS, 1000),
    MAX_TIMEOUT_MS
  );

  return new Promise<string>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const proc = spawn("bash", ["-lc", command], {
      cwd: workdir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
      detached: true,
    });

    // ── Kill helpers ──────────────────────────────────────────────────────
    const killProcess = () => {
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGTERM");
      } catch {
        try { proc.kill("SIGTERM"); } catch { /* already dead */ }
      }
      setTimeout(() => {
        try {
          if (proc.pid) process.kill(-proc.pid, "SIGKILL");
        } catch {
          try { proc.kill("SIGKILL"); } catch { /* already dead */ }
        }
      }, 3000);
    };

    // ── Abort signal ─────────────────────────────────────────────────────
    const onAbort = () => killProcess();

    if (signal) {
      if (signal.aborted) {
        proc.kill("SIGTERM");
        resolve("Command aborted before execution.");
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // ── Timeout ──────────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      timedOut = true;
      killProcess();
    }, timeout);

    // ── Collect stdout ───────────────────────────────────────────────────
    proc.stdout!.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      if (stdoutBytes + chunk.length > MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
        if (remaining > 0) stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = MAX_OUTPUT_BYTES;
        stdoutTruncated = true;
      } else {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });

    // ── Collect stderr ───────────────────────────────────────────────────
    proc.stderr!.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      if (stderrBytes + chunk.length > MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stderrBytes;
        if (remaining > 0) stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = MAX_OUTPUT_BYTES;
        stderrTruncated = true;
      } else {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });

    // ── Process exit ─────────────────────────────────────────────────────
    proc.on("close", (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      // Build output sections
      const sections: string[] = [];

      if (stdout) {
        sections.push(stdout);
        if (stdoutTruncated) {
          sections.push(`(stdout truncated to ${(MAX_OUTPUT_BYTES / 1024).toFixed(0)} KB)`);
        }
      }

      if (stderr) {
        sections.push(`<stderr>\n${stderr}${stderrTruncated ? `\n(stderr truncated to ${(MAX_OUTPUT_BYTES / 1024).toFixed(0)} KB)` : ""}\n</stderr>`);
      }

      // Build metadata
      const meta: string[] = [];
      if (code !== null && code !== 0) {
        meta.push(`Exit code: ${code}`);
      }
      if (timedOut) {
        meta.push(`Command timed out after ${(timeout / 1000).toFixed(0)}s and was terminated.`);
      } else if (signal?.aborted) {
        meta.push("Command was aborted by user.");
      } else if (sig) {
        meta.push(`Process terminated with signal: ${sig}`);
      }

      if (meta.length > 0) {
        sections.push("<command_metadata>\n" + meta.join("\n") + "\n</command_metadata>");
      }

      resolve(sections.join("\n\n") || "(no output)");
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(`Error spawning command: ${err.message}`);
    });
  });
}
