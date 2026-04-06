# Provider Architecture Review

## What We Built

Two OpenAI providers that share the same API format (`/v1/responses`) but differ in auth:

| Provider | File | Endpoint | Auth | Cost |
|----------|------|----------|------|------|
| Codex OAuth | `providers/openai-auth.ts` | `chatgpt.com/backend-api/codex/responses` | OAuth token + refresh | Free (ChatGPT subscription) |
| API Key | `providers/openai-api-key.ts` | `api.openai.com/v1/responses` | `Bearer sk-...` | Pay-per-token |

Both use the same OpenAI Responses API format: `{ model, instructions, input, tools, stream, reasoning }` with SSE events (`response.output_text.delta`, `response.output_item.added`, `response.function_call_arguments.delta`, `response.completed`).

### Factory Resolution Order

```
provider-factory.ts — createProviderFromStoredAuth()

1. Stored OAuth credentials?  → openai-auth.ts     (FREE — preferred)
2. OPENAI_API_KEY env var?    → openai-api-key.ts   (paid fallback)
3. config.apiKeys.openai?     → openai-api-key.ts   (paid fallback)
4. Nothing                    → throw Error
```

OAuth is checked first because it's free for users with a ChatGPT subscription. The API key is a paid fallback for users who don't have or want OAuth.

## Current Architecture

```
runtime.ts
  └─► provider.callLLMStreaming(options)   ← doesn't know which provider
        │
        ▼
provider-factory.ts
  ├─► openai-auth.ts        (OAuth token, Codex endpoint, token refresh + retry)
  └─► openai-api-key.ts     (API key, api.openai.com/v1/responses)
        │
        ▼
Both emit identical StreamChunk events
```

### Files

| File | Lines | Role |
|------|-------|------|
| `src/lib/llm/provider.ts` | 12 | `LLMProvider` interface: `kind`, `callLLM()`, `callLLMStreaming()` |
| `src/lib/llm/provider-factory.ts` | 62 | Credential resolution → provider instantiation |
| `src/lib/llm/providers/openai-auth.ts` | ~470 | Codex OAuth: custom headers, token refresh, retry, validation tracking |
| `src/lib/llm/providers/openai-api-key.ts` | ~330 | Standard API key: simple Bearer header, no token management |
| `src/lib/llm/types.ts` | 98 | Shared types: `LLMMessage`, `StreamChunk`, `LLMUsage`, `StreamingLLMOptions` |
| `src/lib/llm/model-map.ts` | 18 | `resolveOpenAIModel()` + `AVAILABLE_MODELS` |
| `src/lib/llm/config.ts` | 7 | `CODEX_RESPONSES_URL`, `OPENAI_VALIDATION_STALE_MS` |
| `src/lib/config/store.ts` | 77 | Config schema with `apiKeys.openai` field |

### What the Runtime Sees

The runtime (`src/lib/agent/runtime.ts`) calls:
```typescript
for await (const chunk of provider.callLLMStreaming({ messages, tools, model, ... })) {
  // chunk.type: "text_delta" | "tool_call_start" | "tool_call_delta" | "done"
}
```

It never knows or cares which provider is behind `provider`. All tool calling, streaming, and usage tracking flow through the same `StreamChunk` discriminated union.

## Code Duplication Between Providers

Both providers share identical logic for:
- Message transformation: `extractSystemAndInput()` — converts `LLMMessage[]` to `{ instructions, input }` format
- Tool conversion: `convertTools()` — flattens OpenAI function-calling schema to Responses API format
- SSE parsing: `parseResponsesSSE()` — reads Server-Sent Events from `ReadableStream`
- Response event handling: same `switch` on `response.output_text.delta`, `response.output_item.added`, etc.

These are currently duplicated across both files. This is intentional for now — each provider is self-contained and easy to read. But at 3+ providers using the same Responses API format, extract shared code to a `responses-api-shared.ts` utility.

### What Differs Between Providers

| Concern | openai-auth.ts | openai-api-key.ts |
|---------|---------------|-------------------|
| Auth header | `Bearer {oauth_token}` + `ChatGPT-Account-Id` + `originator` + `User-Agent` | `Bearer {api_key}` |
| Endpoint | `chatgpt.com/backend-api/codex/responses` | `api.openai.com/v1/responses` |
| Token refresh | Yes — `ensureValidToken()` with 30s expiry buffer | No — static key |
| Retry logic | 3 attempts, 401→refresh, 429/5xx→backoff | No retry (should add) |
| Validation | Probes with minimal request, tracks status | No validation |
| Cost tracking | `costTracker.record()` | `costTracker.record()` |

## Scalability Issues to Address

### 1. `kind` is a string literal union — change to `string`

```typescript
// Current — must edit this line for every new provider
readonly kind: "openai_auth" | "openai_api_key";

// Better
readonly kind: string;
```

### 2. Shared Responses API logic should be extracted

When adding a third provider that uses the same `/v1/responses` format (e.g., Azure OpenAI, a proxy), create:

```
src/lib/llm/providers/responses-api-shared.ts
  ├── extractSystemAndInput()
  ├── convertTools()
  ├── parseResponsesSSE()
  └── handleStreamEvents()  ← the switch/case block
```

Each provider then only defines: endpoint URL, headers, retry policy.

### 3. No retry on the API key provider

`openai-auth.ts` has a robust retry loop (3 attempts, backoff on 429/5xx). `openai-api-key.ts` has none — a single 429 rate limit kills the request. Add the same retry pattern.

### 4. Config `apiKeys` mixes LLM keys with service keys

```typescript
apiKeys: {
  openai: "sk-...",           // LLM provider
  semanticScholar: "...",     // discovery service
  openAlex: "...",            // discovery service
}
```

When adding Anthropic/Google, restructure:

```typescript
providers: {
  openai: { apiKey: "sk-...", baseUrl?: "..." },
  anthropic: { apiKey: "sk-ant-..." },
},
serviceKeys: {
  semanticScholar: "...",
  openAlex: "...",
}
```

### 5. No provider selection when multiple are available

Currently the factory auto-picks by priority. When a user has both OAuth and API key, there's no way to force the API key. Add:

- `config.activeProvider: "openai-oauth" | "openai-api-key" | "auto"` (default: `"auto"`)
- `/config provider <name>` command
- Status bar indicator showing which provider is active

### 6. Model list is not provider-scoped

`AVAILABLE_MODELS = ["gpt-5.4", "gpt-5.4-mini", "o3", "o4-mini"]` — this is a flat list. When adding Anthropic, models need to be grouped:

```typescript
const PROVIDER_MODELS = {
  openai: ["gpt-5.4", "gpt-5.4-mini", "o3", "o4-mini"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
};
```

## Adding Anthropic (Next Provider)

Anthropic uses a completely different API format — not the Responses API. It needs:

1. **New file:** `src/lib/llm/providers/anthropic.ts`
   - `POST api.anthropic.com/v1/messages`
   - Header: `x-api-key: sk-ant-...` + `anthropic-version: 2023-06-01`
   - Request: `{ model, system, messages, tools, max_tokens, stream }`
   - Different message format: no `system` role in messages (separate param), tool results are `content` blocks not `tool` role
   - Different SSE events: `content_block_delta`, `message_delta`, `message_stop`

2. **Config:** Add `apiKeys.anthropic`, env var `ANTHROPIC_API_KEY`

3. **Factory:** Add resolution step after OpenAI checks

4. **Message transformer:** New `convertToAnthropicFormat()` function — system prompt extracted, tool_calls/tool results converted to Anthropic content block format

5. **No changes to:** runtime.ts, tool-dispatcher.ts, agent tools, TUI

Estimated scope: ~300 lines for the provider, ~20 lines config changes. Isolated to `src/lib/llm/`.

## Recommended Refactoring Timeline

| When | What | Why |
|------|------|-----|
| Now | Add retry logic to `openai-api-key.ts` | Production readiness |
| Before 3rd provider | Extract shared Responses API code | Avoid triple duplication |
| Before 3rd provider | Change `kind` to `string` | Avoid union maintenance |
| Before 3rd provider | Restructure `apiKeys` → `providers` + `serviceKeys` | Clean separation |
| At 3rd provider | Provider-scoped model lists | Different providers have different models |
| At 4+ providers | Registry pattern for factory | Replace if/else chain |
| At 4+ providers | Provider selection UI | Users need to choose |
