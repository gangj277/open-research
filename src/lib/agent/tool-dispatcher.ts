import type { LLMProvider } from "@/lib/llm/provider";
import type { WorkspaceContext, ProposedUpdate } from "./state";
import type { RuntimeSkill } from "@/lib/skills/runtime";
import type { ToolExecutionResult } from "./tools";
import { executeReadFile } from "./tools/read-file";
import { executeListDirectory } from "./tools/list-directory";
import { executeRunCommand } from "./tools/run-command";
import { executeFetchUrl } from "./tools/fetch-url";
import { executeAskUser } from "./tools/ask-user";
import { executeSearchWorkspace } from "./tools/search-workspace";
import { executeWriteNewFile } from "./tools/write-new-file";
import { executeUpdateExistingFile } from "./tools/update-existing-file";
import { executeCreatePaper } from "./tools/create-paper";
import { executeReadPdf } from "./tools/read-pdf";
import { executeSearchExternalSources } from "./search-external-sources";
import { loadRuntimeSkillByName, readSkillReferenceFile } from "@/lib/skills/runtime";
import { runSubAgent, type SubAgentProgress } from "./subagent";
import { executeCreateTasks, executeUpdateTask } from "./tools/tasks";

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: WorkspaceContext,
  activeSkills: RuntimeSkill[],
  homeDir?: string,
  signal?: AbortSignal,
  provider?: LLMProvider,
  onSubAgentProgress?: (progress: SubAgentProgress) => void,
  toolCallId?: string
): Promise<ToolExecutionResult> {
  switch (name) {
    // ── File & Workspace ────────────────────────────────────────────────
    case "read_file":
      return {
        result: await executeReadFile(
          args as { file_path: string; offset?: number; limit?: number },
          ctx
        ),
      };

    // Backward compat: old tool name still works
    case "read_workspace_files":
      return {
        result: await executeReadFile(
          { file_path: (args as { keys: string[] }).keys?.[0] ?? "" },
          ctx
        ),
      };

    case "read_pdf":
      return {
        result: await executeReadPdf(
          args as { file_path: string; pages?: string }
        ),
      };

    case "list_directory":
      return {
        result: await executeListDirectory(
          args as { dir_path?: string; depth?: number; ignore?: string[] }
        ),
      };

    case "search_workspace":
      return {
        result: await executeSearchWorkspace(
          args as { queries: string[]; context_lines?: number; file_keys?: string[]; max_results?: number },
          ctx
        ),
      };

    case "write_new_file": {
      const out = executeWriteNewFile(
        args as { key: string; label: string; content: string; folder?: string },
        ctx
      );
      return { result: out.result, proposedUpdate: out.update ?? undefined };
    }

    case "update_existing_file": {
      const out = executeUpdateExistingFile(
        args as
          | { key: string; summary: string; mode?: "rewrite"; content: string }
          | { key: string; summary: string; mode: "targeted"; edits: Array<{ old_str: string; new_str: string; replace_all?: boolean }> },
        ctx
      );
      return { result: out.result, proposedUpdate: out.update ?? undefined };
    }

    // ── Shell Execution ─────────────────────────────────────────────────
    case "run_command":
      return {
        result: await executeRunCommand(
          args as { command: string; workdir?: string; timeout?: number; description?: string },
          signal
        ),
      };

    // ── Web & Discovery ─────────────────────────────────────────────────
    case "fetch_url":
      return {
        result: await executeFetchUrl(
          args as { url: string; format?: "text" | "html" | "raw"; timeout?: number },
          signal
        ),
      };

    case "search_external_sources": {
      const out = await executeSearchExternalSources(
        args as { searches: Array<{ query: string; intent: string }>; num_results?: number },
        ctx
      );
      return { result: out.result, searchResults: out.sources };
    }

    // ── User Interaction ────────────────────────────────────────────────
    case "ask_user":
      return {
        result: await executeAskUser(
          args as {
            question: string;
            options?: Array<{ label: string; description: string }>;
            allow_custom?: boolean;
          },
          signal
        ),
      };

    // ── Skills ──────────────────────────────────────────────────────────
    case "load_skill": {
      const skill = await loadRuntimeSkillByName({
        homeDir,
        name: String(args.skill_id ?? ""),
      });
      if (!skill) {
        return { result: `Unknown skill "${String(args.skill_id ?? "")}".` };
      }
      return {
        result: `Skill "${skill.name}" activated.`,
        loadedSkillId: skill.id,
      };
    }

    case "read_skill_reference": {
      const active = activeSkills.find((skill) => skill.id === String(args.skill_id ?? ""));
      if (!active) {
        return { result: `Skill "${String(args.skill_id ?? "")}" is not active.` };
      }
      return {
        result: await readSkillReferenceFile(active.skillDir, String(args.path ?? "")),
      };
    }

    // ── Paper Creation ──────────────────────────────────────────────────
    case "create_paper": {
      const out = executeCreatePaper(args as { title: string; content: string }, ctx);
      return { result: out.result, proposedUpdate: out.update };
    }

    // ── Sub-Agent ──────────────────────────────────────────────────────
    case "launch_subagent": {
      if (!provider) {
        return { result: "Error: sub-agent requires an LLM provider but none was available." };
      }
      const { type, goal, context } = args as { type: string; goal: string; context?: string };
      const result = await runSubAgent({
        agentId: toolCallId ?? crypto.randomUUID(),
        provider,
        type,
        goal,
        context,
        workspace: ctx,
        homeDir,
        signal,
        onProgress: onSubAgentProgress,
      });
      const meta = `[${result.toolCallCount} tool calls · ${(result.durationMs / 1000).toFixed(1)}s${result.hitLimit ? " · hit iteration limit" : ""}]`;
      return { result: `${result.summary}\n\n${meta}` };
    }

    // ── Task Tracking ────────────────────────────────────────────────
    case "create_tasks":
      return {
        result: executeCreateTasks(args as { tasks: Array<{ subject: string; activeForm?: string }> }),
      };

    case "update_task":
      return {
        result: executeUpdateTask(args as { taskId: string; status?: string; subject?: string; activeForm?: string }),
      };

    default:
      return { result: `Unknown tool: "${name}"` };
  }
}
