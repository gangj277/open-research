import fs from "node:fs/promises";
import {
  getOpenResearchAuthFile,
  getOpenResearchGeminiAuthFile,
  getOpenResearchRoot,
  type PathOptions,
} from "@/lib/fs/paths";
import { readJsonFile, writeJsonFile } from "@/lib/fs/json";
import type { StoredOpenAIAuth } from "@/lib/storage/credential-types";

const AUTH_FILE_MODE = 0o600;

export async function ensureCliHome(options?: PathOptions): Promise<string> {
  const root = getOpenResearchRoot(options);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

export async function saveStoredAuth(
  auth: StoredOpenAIAuth,
  options?: PathOptions
): Promise<string> {
  await ensureCliHome(options);
  const authFile = getOpenResearchAuthFile(options);
  await writeJsonFile(authFile, auth, AUTH_FILE_MODE);
  await fs.chmod(authFile, AUTH_FILE_MODE);
  return authFile;
}

export async function loadStoredAuth(
  options?: PathOptions
): Promise<StoredOpenAIAuth | null> {
  const authFile = getOpenResearchAuthFile(options);
  return readJsonFile<StoredOpenAIAuth | null>(authFile, null);
}

export async function clearStoredAuth(options?: PathOptions): Promise<void> {
  const authFile = getOpenResearchAuthFile(options);
  await fs.rm(authFile, { force: true });
}

// ── Gemini Auth ────────────────────────────────────────────────────────────

export interface GeminiAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  email: string;
  projectId: string;
}

export interface StoredGeminiAuth {
  provider: "gemini_auth";
  tokens: GeminiAuthTokens;
  createdAt: string;
  updatedAt: string;
}

export async function saveGeminiAuth(
  auth: StoredGeminiAuth,
  options?: PathOptions,
): Promise<string> {
  await ensureCliHome(options);
  const authFile = getOpenResearchGeminiAuthFile(options);
  await writeJsonFile(authFile, auth, AUTH_FILE_MODE);
  await fs.chmod(authFile, AUTH_FILE_MODE);
  return authFile;
}

export async function loadGeminiAuth(
  options?: PathOptions,
): Promise<StoredGeminiAuth | null> {
  const authFile = getOpenResearchGeminiAuthFile(options);
  return readJsonFile<StoredGeminiAuth | null>(authFile, null);
}

export async function clearGeminiAuth(options?: PathOptions): Promise<void> {
  const authFile = getOpenResearchGeminiAuthFile(options);
  await fs.rm(authFile, { force: true });
}
