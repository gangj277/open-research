import {
  getDefaultCredentialCapabilities,
  type CredentialValidation,
} from "@/lib/storage/credential-types";
import { CODEX_RESPONSES_URL } from "./config";
import { getDefaultModel, selectModelForTask } from "./provider-catalog";

export interface OpenAIConnectionInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
}

export interface OpenAIConnectionResult extends CredentialValidation {
  ok: boolean;
}

const VALIDATION_INSTRUCTIONS =
  "You are validating whether this OpenAI Codex connection can execute a minimal request. Reply with the single word ok.";

function buildHeaders(token: string, accountId: string): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  return headers;
}

function failureResult(
  status: CredentialValidation["status"],
  code: number | null,
  message: string,
  capabilities = getDefaultCredentialCapabilities()
): OpenAIConnectionResult {
  return {
    ok: false,
    status,
    validatedAt: new Date().toISOString(),
    capabilities,
    lastErrorCode: code,
    lastErrorMessage: message,
  };
}

function extractProviderErrorMessage(errorBody: string): string {
  if (!errorBody) {
    return "Provider validation failed.";
  }

  try {
    const parsed = JSON.parse(errorBody) as Record<string, unknown>;

    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }

    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }

    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      typeof (parsed.error as Record<string, unknown>).message === "string"
    ) {
      return String((parsed.error as Record<string, unknown>).message);
    }
  } catch {
    // Fall back to the raw body when the provider did not return JSON.
  }

  return errorBody;
}

function buildValidationProbeBody(model: string): Record<string, unknown> {
  return {
    model,
    instructions: VALIDATION_INSTRUCTIONS,
    stream: true,
    store: false,
    input: [{ role: "user", content: "Reply with the single word ok." }],
  };
}

async function runProbe(
  input: OpenAIConnectionInput,
  body: Record<string, unknown>
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    return await fetch(CODEX_RESPONSES_URL, {
      method: "POST",
      headers: buildHeaders(input.accessToken, input.accountId),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateOpenAIConnection(
  input: OpenAIConnectionInput
): Promise<OpenAIConnectionResult> {
  if (process.env.OPENAI_AUTH_ONLY === "false") {
    return failureResult(
      "invalid",
      null,
      "OpenAI auth runtime is disabled by configuration."
    );
  }

  try {
    const basicModel = getDefaultModel("openai_auth");
    const liteModel = selectModelForTask("openai_auth", basicModel, "workspace");
    const basicResponse = await runProbe(input, buildValidationProbeBody(basicModel));

    if (!basicResponse.ok) {
      const errorBody = await basicResponse.text();
      return failureResult(
        basicResponse.status === 429 || basicResponse.status >= 500 ? "degraded" : "invalid",
        basicResponse.status,
        extractProviderErrorMessage(errorBody)
      );
    }

    const capabilities = {
      basic: true,
      json: true,
      streaming: true,
      toolCalling: true,
      liteModel: true,
    };

    const liteModelProbe = await runProbe(
      input,
      buildValidationProbeBody(liteModel)
    );

    if (!liteModelProbe.ok) {
      capabilities.liteModel = false;
    }

    return {
      ok: true,
      status: capabilities.liteModel ? "valid" : "degraded",
      validatedAt: new Date().toISOString(),
      capabilities,
      lastErrorCode: liteModelProbe.ok ? null : liteModelProbe.status,
      lastErrorMessage: liteModelProbe.ok
        ? null
        : extractProviderErrorMessage(await liteModelProbe.text()),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider validation failed.";
    return failureResult("degraded", null, message);
  }
}
