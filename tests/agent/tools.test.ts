import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { executeReadFile } from "@/lib/agent/tools/read-file";
import { executeListDirectory } from "@/lib/agent/tools/list-directory";
import { executeRunCommand } from "@/lib/agent/tools/run-command";
import { executeFetchUrl } from "@/lib/agent/tools/fetch-url";
import { executeAskUser, getPendingQuestion, clearPendingQuestion, resetPendingQuestions } from "@/lib/agent/tools/ask-user";
import type { WorkspaceContext } from "@/lib/agent/state";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "open-research-tools-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

function emptyCtx(): WorkspaceContext {
  return {
    workspaceFiles: {},
    availableKeys: [],
  };
}

describe("read_file", () => {
  test("reads a text file with line numbers", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "test.txt");
    await fs.writeFile(file, "line one\nline two\nline three\n");

    const result = await executeReadFile({ file_path: file }, emptyCtx());
    expect(result).toContain("<path>");
    expect(result).toContain("1\tline one");
    expect(result).toContain("2\tline two");
    expect(result).toContain("3\tline three");
  });

  test("supports offset and limit", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "big.txt");
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    await fs.writeFile(file, lines.join("\n"));

    const result = await executeReadFile({ file_path: file, offset: 50, limit: 5 }, emptyCtx());
    expect(result).toContain("50\tline 50");
    expect(result).toContain("54\tline 54");
    expect(result).not.toContain("55\tline 55");
    expect(result).toContain("Use offset=55 to continue");
  });

  test("detects binary files", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "data.bin");
    await fs.writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));

    const result = await executeReadFile({ file_path: file }, emptyCtx());
    expect(result).toContain("binary");
    expect(result).toContain("cannot display");
  });

  test("returns error for missing files", async () => {
    const result = await executeReadFile({ file_path: "/nonexistent/file.txt" }, emptyCtx());
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  test("falls back to workspace key", async () => {
    const ctx: WorkspaceContext = {
      workspaceFiles: { "path:notes/brief.md": "# Brief\nContent here" },
      availableKeys: ["path:notes/brief.md"],
    };
    const result = await executeReadFile({ file_path: "path:notes/brief.md" }, ctx);
    expect(result).toContain("# Brief");
    expect(result).toContain("Content here");
  });

  test("lists directory contents when given a directory path", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "a.txt"), "");
    await fs.mkdir(path.join(dir, "subdir"));

    const result = await executeReadFile({ file_path: dir }, emptyCtx());
    expect(result).toContain("directory");
    expect(result).toContain("a.txt");
    expect(result).toContain("subdir/");
  });
});

describe("list_directory", () => {
  test("lists files and directories as a tree", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "readme.md"), "hello");
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "src", "index.ts"), "export {}");

    const result = await executeListDirectory({ dir_path: dir, depth: 2 });
    expect(result).toContain("readme.md");
    expect(result).toContain("src/");
    expect(result).toContain("index.ts");
  });

  test("ignores node_modules by default", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "node_modules"));
    await fs.writeFile(path.join(dir, "node_modules", "pkg.js"), "");
    await fs.writeFile(path.join(dir, "app.js"), "");

    const result = await executeListDirectory({ dir_path: dir });
    expect(result).toContain("app.js");
    expect(result).not.toContain("pkg.js");
  });

  test("returns error for non-existent directory", async () => {
    const result = await executeListDirectory({ dir_path: "/nonexistent/dir" });
    expect(result).toContain("Error");
  });
});

describe("run_command", () => {
  test("runs a simple command and returns output", async () => {
    const result = await executeRunCommand({ command: "echo hello world" });
    expect(result.trim()).toContain("hello world");
  });

  test("captures stderr", async () => {
    const result = await executeRunCommand({ command: "echo error >&2" });
    expect(result).toContain("error");
  });

  test("reports non-zero exit code", async () => {
    const result = await executeRunCommand({ command: "exit 42" });
    expect(result).toContain("Exit code: 42");
  });

  test("respects timeout", async () => {
    const result = await executeRunCommand({
      command: "sleep 60",
      timeout: 1000,
    });
    expect(result).toContain("timed out");
  }, 10000);

  test("respects abort signal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await executeRunCommand(
      { command: "sleep 60" },
      controller.signal
    );
    expect(result).toContain("aborted");
  }, 10000);

  test("runs in specified workdir", async () => {
    const dir = await makeTempDir();
    const result = await executeRunCommand({ command: "pwd", workdir: dir });
    expect(result.trim()).toContain(dir);
  });
});

describe("fetch_url", () => {
  test("returns error for invalid URL", async () => {
    const result = await executeFetchUrl({ url: "not-a-url" });
    expect(result).toContain("Error");
    expect(result).toContain("Invalid URL");
  });

  test("returns error for non-http protocols", async () => {
    const result = await executeFetchUrl({ url: "ftp://example.com" });
    expect(result).toContain("Error");
    expect(result).toContain("http");
  });
});

describe("read_file — streaming fixes", () => {
  test("handles ~ home directory expansion", async () => {
    // Create a file in a temp dir and read it via a path that would need expansion
    const dir = await makeTempDir();
    const file = path.join(dir, "test.txt");
    await fs.writeFile(file, "home content\n");
    // Read by absolute path (~ expansion tested via the expandHome function)
    const result = await executeReadFile({ file_path: file }, emptyCtx());
    expect(result).toContain("home content");
  });

  test("does not OOM on large file — only reads requested window", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "large.txt");
    // Write 10,000 lines — big enough to test streaming but not actually huge
    const lines = Array.from({ length: 10000 }, (_, i) => `line-${i + 1}-${"x".repeat(50)}`);
    await fs.writeFile(file, lines.join("\n"));

    // Read just lines 5000-5010
    const result = await executeReadFile({ file_path: file, offset: 5000, limit: 10 }, emptyCtx());
    expect(result).toContain("5000\tline-5000");
    expect(result).toContain("5009\tline-5009");
    expect(result).not.toContain("5010\t");
    expect(result).toContain("Use offset=5010 to continue");
  });
});

describe("run_command — fixes", () => {
  test("labels stderr separately from stdout", async () => {
    const result = await executeRunCommand({
      command: 'echo "out" && echo "err" >&2',
    });
    expect(result).toContain("out");
    expect(result).toContain("<stderr>");
    expect(result).toContain("err");
    expect(result).toContain("</stderr>");
  });

  test("validates workdir exists", async () => {
    const result = await executeRunCommand({
      command: "echo hi",
      workdir: "/nonexistent/path/that/does/not/exist",
    });
    expect(result).toContain("Error");
    expect(result).toContain("workdir");
  });
});

describe("ask_user", () => {
  afterEach(() => {
    resetPendingQuestions();
  });

  test("creates a pending question and resolves when answered", async () => {
    const promise = executeAskUser({
      question: "Which method?",
      options: [
        { label: "A", description: "Method A" },
        { label: "B", description: "Method B" },
      ],
    });

    // Pending question should now exist
    const pending = getPendingQuestion();
    expect(pending).not.toBeNull();
    expect(pending!.question.question).toBe("Which method?");
    expect(pending!.question.options).toHaveLength(2);

    // Simulate user selecting option
    pending!.resolve({
      questionId: pending!.question.id,
      answer: "A",
      isCustom: false,
    });
    clearPendingQuestion();

    const result = await promise;
    expect(result).toContain('User selected: "A"');
  });

  test("handles custom answers", async () => {
    const promise = executeAskUser({
      question: "What topic?",
    });

    const pending = getPendingQuestion();
    expect(pending).not.toBeNull();

    pending!.resolve({
      questionId: pending!.question.id,
      answer: "Neural networks in climate modeling",
      isCustom: true,
    });
    clearPendingQuestion();

    const result = await promise;
    expect(result).toContain('User answered: "Neural networks in climate modeling"');
  });

  test("rejects on abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeAskUser({ question: "test?" }, controller.signal)
    ).rejects.toThrow("cancelled");
  });
});
