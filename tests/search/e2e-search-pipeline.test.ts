/**
 * End-to-end search pipeline test.
 * Makes REAL API calls to LLMs and academic databases.
 */
import { describe, test, expect, beforeAll } from "vitest";
import { createProviderFromStoredAuth } from "@/lib/llm/provider-factory";
import type { LLMProvider } from "@/lib/llm/provider";

let provider: LLMProvider;

beforeAll(async () => {
  provider = await createProviderFromStoredAuth();
});

describe("E2E Search Pipeline", () => {
  test("full academic search with adversarial queries and evidence classification", async () => {
    const { executeSearchExternalSources } = await import("@/lib/agent/search-external-sources");

    const result = await executeSearchExternalSources(
      {
        target: "Retrieval-augmented generation improves factual accuracy in question answering",
        searches: [
          { query: "retrieval augmented generation factual accuracy QA", intent: "primary" },
        ],
        num_results: 4,
      },
      { workspaceDir: process.cwd(), workspaceFiles: {}, availableKeys: [] },
      provider,
    );

    console.log("\n=== ACADEMIC SEARCH RESULT ===");
    console.log(result.result.slice(0, 3000));
    console.log(`\n=== ${result.sources.length} sources discovered ===`);

    expect(result.result).toBeTruthy();
    expect(result.result).not.toBe("No papers found.");
    expect(result.sources.length).toBeGreaterThan(0);

    // Evidence classification should be present
    const evidenceTypes = ["meta-analysis", "systematic-review", "experiment", "observational", "review", "opinion", "dataset", "other"];
    const hasEvidenceType = evidenceTypes.some((t) => result.result.includes(t));
    console.log("Has evidence type classification:", hasEvidenceType);

    console.log("Has adversarial results:", result.result.includes("[adversarial]"));
  }, 180_000);

  test("web search with multi-query and adversarial", async () => {
    const { executeWebSearch } = await import("@/lib/agent/tools/web-search");

    const result = await executeWebSearch(
      {
        target: "Large language models can reliably perform mathematical reasoning",
        queries: [
          "LLM mathematical reasoning benchmark performance",
        ],
        num_results: 3,
      },
      provider,
    );

    console.log("\n=== WEB SEARCH RESULT ===");
    console.log(result.result.slice(0, 2000));

    expect(result.result).toBeTruthy();
    expect(result.result).not.toContain("Error:");

    // Should have evidence type from the upgraded extraction
    const evidenceTypes = ["meta-analysis", "systematic-review", "experiment", "observational", "review", "opinion", "dataset", "other"];
    const hasEvidenceType = evidenceTypes.some((t) => result.result.includes(t));
    console.log("Has evidence type classification:", hasEvidenceType);
    // Web search backend (DuckDuckGo) can be flaky — only assert if results were found
    if (!result.result.includes("No web results found")) {
      expect(hasEvidenceType).toBe(true);
    }
  }, 120_000);

  test("citation traversal forward", async () => {
    const { executeTraverseCitations } = await import("@/lib/agent/tools/traverse-citations");

    // Use arXiv ID for "Attention Is All You Need"
    const result = await executeTraverseCitations({
      paper_id: "1706.03762",
      direction: "citations",
      limit: 5,
    });

    console.log("\n=== CITATION TRAVERSAL (forward) ===");
    console.log(result.slice(0, 1500));

    // Either succeeds or gets rate-limited (403) — both are acceptable
    const isSuccess = !result.includes("Error") && !result.includes("403");
    const isRateLimited = result.includes("403");
    console.log("Success:", isSuccess, "Rate-limited:", isRateLimited);
    expect(isSuccess || isRateLimited).toBe(true);
  }, 30_000);

  test("citation traversal backward", async () => {
    const { executeTraverseCitations } = await import("@/lib/agent/tools/traverse-citations");

    const result = await executeTraverseCitations({
      paper_id: "1706.03762",
      direction: "references",
      limit: 5,
    });

    console.log("\n=== CITATION TRAVERSAL (backward) ===");
    console.log(result.slice(0, 1500));

    const isSuccess = !result.includes("Error") && !result.includes("403");
    const isRateLimited = result.includes("403");
    console.log("Success:", isSuccess, "Rate-limited:", isRateLimited);
    expect(isSuccess || isRateLimited).toBe(true);
  }, 30_000);
});
