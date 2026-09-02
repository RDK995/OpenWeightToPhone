import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const APP_MOUNT_PATH = "/app";
export const DEFAULT_PWA_PORT = 7788;

export function resolvePwaPort(
  env: Record<string, string | undefined> = process.env
): number {
  const port = env.PHONE_PWA_PORT;

  if (!port || port === "") {
    return DEFAULT_PWA_PORT;
  }

  const parsed = parseInt(port, 10);

  // Check if it's a valid integer in base-10
  if (isNaN(parsed) || parsed.toString() !== port) {
    throw new Error(
      `PHONE_PWA_PORT must be an integer in the range 1-65535, got "${port}"`
    );
  }

  // Check if it's in the valid port range
  if (parsed < 1 || parsed > 65535) {
    throw new Error(
      `PHONE_PWA_PORT must be an integer in the range 1-65535, got "${port}"`
    );
  }

  return parsed;
}

export function resolveBaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const baseUrl = env.OPENWEIGHT_HARNESS_BASE_URL;

  if (!baseUrl || baseUrl === "") {
    return "https://ryans-mac-studio.tailc3648a.ts.net";
  }

  // Strip trailing slashes
  return baseUrl.replace(/\/+$/, "");
}

export function resolveTokenPath(
  env: Record<string, string | undefined> = process.env
): string {
  const tokenFile = env.OPENWEIGHT_HARNESS_TOKEN_FILE;

  if (tokenFile && tokenFile !== "") {
    return tokenFile;
  }

  return join(homedir(), ".openweight-harness", "token");
}

export function resolveBundleRoot(
  env: Record<string, string | undefined> = process.env
): string {
  const bundleRoot = env.PHONE_PWA_BUNDLE_ROOT;

  if (bundleRoot && bundleRoot !== "") {
    return bundleRoot;
  }

  // Get the repository root from this file's location
  // This file is at src/host/config.ts, so we go up three directories
  const currentFileUrl = import.meta.url;
  const currentFilePath = fileURLToPath(currentFileUrl);
  const repoRoot = join(currentFilePath, "..", "..", "..");

  return join(repoRoot, "web", "dist");
}

export function pairingUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const baseUrl = resolveBaseUrl(env);
  return `${baseUrl}${APP_MOUNT_PATH}/`;
}

export function pairingUrlWithToken(
  token: string,
  env: Record<string, string | undefined> = process.env
): string {
  // Throw on empty or whitespace-only token
  if (!token || token.trim() === "") {
    throw new Error("Token must not be empty or whitespace-only");
  }

  return `${resolveBaseUrl(env)}${APP_MOUNT_PATH}/#t=${encodeURIComponent(token)}`;
}

export function readToken(
  env: Record<string, string | undefined> = process.env
): string {
  const tokenPath = resolveTokenPath(env);

  // Step 1: stat the file
  const stat = statSync(tokenPath);

  // Step 2: check permissions - reject if group or other can read
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `Token file ${tokenPath} is readable by group or other (mode ${(stat.mode & 0o777).toString(8)})`
    );
  }

  // Step 3: read the file contents
  const content = readFileSync(tokenPath, "utf-8").trim();

  // Check that content is not empty after trimming
  if (content === "") {
    throw new Error(`Token file ${tokenPath} is empty after trimming`);
  }

  return content;
}
