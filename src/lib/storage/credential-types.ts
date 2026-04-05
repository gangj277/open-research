export type ProviderKind = "openai_auth";
export type CredentialValidationStatus = "valid" | "invalid" | "degraded";

export interface CredentialCapabilities {
  basic: boolean;
  json: boolean;
  streaming: boolean;
  toolCalling: boolean;
  liteModel: boolean;
}

export interface CredentialValidation {
  status: CredentialValidationStatus;
  validatedAt?: string | null;
  capabilities: CredentialCapabilities;
  lastErrorCode?: number | null;
  lastErrorMessage?: string | null;
}

export interface OpenAIAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

export interface StoredOpenAIAuth {
  provider: ProviderKind;
  tokens: OpenAIAuthTokens;
  validation: CredentialValidation;
  importedFrom?: "codex" | "oauth";
  createdAt: string;
  updatedAt: string;
}

export function getDefaultCredentialCapabilities(): CredentialCapabilities {
  return {
    basic: false,
    json: false,
    streaming: false,
    toolCalling: false,
    liteModel: false,
  };
}

export function getDefaultCredentialValidation(): CredentialValidation {
  return {
    status: "invalid",
    validatedAt: null,
    capabilities: getDefaultCredentialCapabilities(),
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

export function getBootstrapCredentialValidation(): CredentialValidation {
  return {
    status: "degraded",
    validatedAt: null,
    capabilities: {
      basic: true,
      json: true,
      streaming: true,
      toolCalling: true,
      liteModel: false,
    },
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}
