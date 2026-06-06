import { stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config/config.js";
import { readJsonSafe, writeJsonAtomic } from "../util/atomicJson.js";
import { ensureSecureDir } from "./sessionStore.js";

const TOKEN_VERSION = 1;

/**
 * @typedef {{
 *   version?: number;
 *   savedAt?: string;
 *   access_token: string;
 *   refresh_token?: string;
 *   token_type?: string;
 *   expires_at?: number;
 * }} OAuthTokenSet
 */

/**
 * @param {OAuthTokenSet} tokenSet
 */
export async function saveOAuthTokens(tokenSet) {
  const payload = {
    ...tokenSet,
    version: TOKEN_VERSION,
    savedAt: new Date().toISOString(),
  };
  await ensureSecureDir(dirname(config.oauthTokensPath));
  await writeJsonAtomic(config.oauthTokensPath, payload);
}

/**
 * @returns {Promise<OAuthTokenSet | null>}
 */
export async function loadOAuthTokens() {
  const data = await readJsonSafe(config.oauthTokensPath, {
    fallback: null,
    label: "oauth-tokens.json",
  });
  if (!data || typeof data !== "object" || !data.access_token) return null;
  return data;
}

export async function oauthTokensFileInfo() {
  try {
    const s = await stat(config.oauthTokensPath);
    return { exists: true, size: s.size, mtime: s.mtime.toISOString() };
  } catch (err) {
    if (err && err.code === "ENOENT") return { exists: false };
    throw err;
  }
}

export async function removeOAuthTokens() {
  try {
    await unlink(config.oauthTokensPath);
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

/**
 * @param {OAuthTokenSet | null | undefined} tokenSet
 */
export function describeOAuthTokens(tokenSet) {
  if (!tokenSet?.access_token) {
    return { present: false };
  }
  const expiresAt = tokenSet.expires_at;
  const expiresInMs =
    typeof expiresAt === "number" ? expiresAt - Date.now() : null;
  return {
    present: true,
    savedAt: tokenSet.savedAt || null,
    hasRefreshToken: !!tokenSet.refresh_token,
    expiresAt:
      typeof expiresAt === "number" ? new Date(expiresAt).toISOString() : null,
    expiresInMinutes:
      expiresInMs != null && Number.isFinite(expiresInMs)
        ? Math.round(expiresInMs / 60000)
        : null,
    expired: typeof expiresAt === "number" ? expiresAt <= Date.now() : false,
  };
}
