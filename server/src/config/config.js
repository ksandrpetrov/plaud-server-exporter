import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = resolve(dirname(__filename), "..", "..");
const REPO_ROOT = resolve(SERVER_ROOT, "..");

const ENV_FILE = process.env.PLAUD_ENV_FILE || resolve(REPO_ROOT, ".env");
if (existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE });
}

function asBool(value, fallback) {
  if (value == null || value === "") return fallback;
  const lower = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(lower)) return true;
  if (["0", "false", "no", "off"].includes(lower)) return false;
  return fallback;
}

function asInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function absPath(value, fallback) {
  const raw = value && String(value).trim();
  return raw ? resolve(raw) : fallback;
}

function dataDir() {
  return absPath(process.env.PLAUD_DATA_DIR, resolve(SERVER_ROOT, ".data"));
}

const staticConfig = {
  repoRoot: REPO_ROOT,
  serverRoot: SERVER_ROOT,
  get dataDir() {
    return dataDir();
  },
  get sessionPath() {
    return absPath(process.env.PLAUD_SESSION_PATH, join(dataDir(), "session.json"));
  },
  get syncIndexPath() {
    return absPath(process.env.PLAUD_SYNC_INDEX_PATH, join(dataDir(), "sync-index.json"));
  },
  get statusPath() {
    return absPath(process.env.PLAUD_STATUS_PATH, join(dataDir(), "status.json"));
  },
  get playwrightProfileDir() {
    return absPath(
      process.env.PLAUD_PLAYWRIGHT_PROFILE_DIR,
      join(dataDir(), "playwright-profile")
    );
  },
  get exportRoot() {
    return absPath(process.env.PLAUD_EXPORT_ROOT, resolve(REPO_ROOT, "exports"));
  },
  get obsidianVaultPath() {
    return process.env.PLAUD_OBSIDIAN_VAULT_PATH
      ? absPath(process.env.PLAUD_OBSIDIAN_VAULT_PATH)
      : null;
  },
  get obsidianSubfolder() {
    return (process.env.PLAUD_OBSIDIAN_SUBFOLDER || "Plaud").trim();
  },
  get mirrorFolders() {
    return asBool(process.env.PLAUD_MIRROR_FOLDERS, true);
  },
  get timezone() {
    return (process.env.PLAUD_TIMEZONE || "UTC").trim();
  },
  get apiConcurrency() {
    return asInt(process.env.PLAUD_API_CONCURRENCY, 4);
  },
  get apiTimeoutMs() {
    return asInt(process.env.PLAUD_API_TIMEOUT_MS, 45000);
  },
  get apiMaxRetries() {
    return asInt(process.env.PLAUD_API_MAX_RETRIES, 3);
  },
  get apiPageLimit() {
    return asInt(process.env.PLAUD_API_PAGE_LIMIT, 100);
  },
  get apiMaxFiles() {
    return asInt(process.env.PLAUD_API_MAX_FILES, 5000);
  },
  get plaudWebOrigin() {
    return (process.env.PLAUD_WEB_ORIGIN || "https://web.plaud.ai").trim();
  },
};

export const config = staticConfig;

/**
 * Returns the vault path effectively used by the writer.
 * If PLAUD_OBSIDIAN_VAULT_PATH is unset, exports go directly under exportRoot.
 */
export function effectiveVaultRoot() {
  return config.obsidianVaultPath || config.exportRoot;
}
