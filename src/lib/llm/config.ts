export const OPENAI_AUTH_ONLY =
  process.env.OPENAI_AUTH_ONLY !== "false";

export const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL ??
  "https://chatgpt.com/backend-api/codex/responses";
