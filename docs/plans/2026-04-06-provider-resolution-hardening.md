# Provider Resolution Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make provider resolution, availability checks, and model selection more scalable without changing current OpenAI OAuth and API-key capabilities.

**Architecture:** Introduce a shared provider catalog and provider resolution layer so config parsing, provider instantiation, UI gating, and background model selection all use the same source of truth. Preserve current OpenAI behavior while adding backward-compatible config structure and capability-aware metadata for future providers.

**Tech Stack:** TypeScript, Node.js, Vitest, Ink/React

---

### Task 1: Lock behavior with failing tests

**Files:**
- Create: `tests/llm/provider-resolution.test.ts`
- Modify: `tests/config/store.test.ts`
- Modify: `tests/agent/context-manager.test.ts`

**Step 1: Write failing tests**

Add tests that verify:
- provider availability is true for env key, config key, provider config key, or stored OAuth
- provider resolution precedence remains env > provider config > legacy config > OAuth
- config loader accepts both legacy `apiKeys.openai` and new `providers.openai.apiKey`
- compact model selection uses provider metadata instead of string heuristics

**Step 2: Run targeted tests to verify they fail**

Run: `npm test -- tests/config/store.test.ts tests/agent/context-manager.test.ts tests/llm/provider-resolution.test.ts`

Expected: failures for missing provider resolution helpers and metadata-driven compact model behavior

### Task 2: Add shared provider catalog and resolution helpers

**Files:**
- Create: `src/lib/llm/provider-catalog.ts`
- Create: `src/lib/llm/provider-resolution.ts`
- Modify: `src/lib/config/store.ts`
- Modify: `src/lib/llm/provider-factory.ts`

**Step 1: Add provider catalog**

Create a provider catalog with:
- provider family metadata
- supported models
- default model
- compact/background model
- helpers for validating models and resolving fallback models

**Step 2: Add provider resolution helpers**

Centralize:
- config loading
- env/config/auth precedence
- availability checks
- provider source metadata

**Step 3: Refactor provider factory**

Make `createProviderFromStoredAuth()` consume the shared resolver instead of reimplementing credential lookup.

### Task 3: Unify app/auth status behavior with provider availability

**Files:**
- Modify: `src/lib/auth/status.ts`
- Modify: `src/cli.ts`
- Modify: `src/tui/app.tsx`

**Step 1: Replace stored-auth-only connection checks**

Use provider availability helpers anywhere the app currently decides whether the user is “connected.”

**Step 2: Preserve current commands and capabilities**

Keep `/auth`, `/config apikey`, OAuth import/login, and provider factory behavior intact while broadening the gating logic to accept API-key-only setups.

### Task 4: Remove hardcoded model heuristics from background paths

**Files:**
- Modify: `src/lib/agent/context-manager.ts`
- Modify: `src/lib/memory/extractor.ts`
- Modify: `src/lib/workspace/init-agents-md.ts`
- Modify: `src/lib/llm/provider.ts`
- Modify: `src/lib/llm/providers/openai-auth.ts`
- Modify: `src/lib/llm/providers/openai-api-key.ts`

**Step 1: Add provider metadata to `LLMProvider`**

Expose provider info needed for safe model selection in background tasks.

**Step 2: Switch background paths to metadata-driven model selection**

Replace hardcoded `gpt-5.4-mini` and `"5.4"` string checks with shared helper usage.

### Task 5: Verify behavior end-to-end

**Files:**
- Test: `tests/config/store.test.ts`
- Test: `tests/agent/context-manager.test.ts`
- Test: `tests/llm/provider-resolution.test.ts`
- Test: `tests/tui/app.test.tsx`

**Step 1: Run targeted tests**

Run: `npm test -- tests/config/store.test.ts tests/agent/context-manager.test.ts tests/llm/provider-resolution.test.ts tests/tui/app.test.tsx`

**Step 2: Run broader suite if targeted tests pass**

Run: `npm test`

**Step 3: Review remaining gaps**

If any existing tests rely on old auth-only assumptions, update them only where behavior intentionally changed to include API-key-backed provider availability.
