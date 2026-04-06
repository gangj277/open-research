import { describe, expect, test } from "vitest";
import { isParallelSafe } from "@/lib/agent/tool-schemas";

describe("tool concurrency metadata", () => {
  test("marks read-only and isolated exploration tools as parallel-safe", () => {
    expect(isParallelSafe("read_file")).toBe(true);
    expect(isParallelSafe("read_pdf")).toBe(true);
    expect(isParallelSafe("list_directory")).toBe(true);
    expect(isParallelSafe("search_workspace")).toBe(true);
    expect(isParallelSafe("search_external_sources")).toBe(true);
    expect(isParallelSafe("fetch_url")).toBe(true);
    expect(isParallelSafe("launch_subagent")).toBe(true);
    expect(isParallelSafe("load_skill")).toBe(true);
    expect(isParallelSafe("read_skill_reference")).toBe(true);
  });

  test("keeps side-effecting or blocking tools sequential", () => {
    expect(isParallelSafe("write_new_file")).toBe(false);
    expect(isParallelSafe("update_existing_file")).toBe(false);
    expect(isParallelSafe("run_command")).toBe(false);
    expect(isParallelSafe("ask_user")).toBe(false);
    expect(isParallelSafe("create_paper")).toBe(false);
    expect(isParallelSafe("unknown_tool")).toBe(false);
  });
});
