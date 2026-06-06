import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

/** Basenames of JSON state files under `server/.data/` (or PLAUD_DATA_DIR). */
export const DATA_STATE_FILE_NAMES = [
  "session.json",
  "oauth-tokens.json",
  "sync-index.json",
  "status.json",
  "owner-chat.json",
  "bot-settings.json",
  "telegram-offset.json",
  "tree-browse.json",
];

const staticConfig = {
  repoRoot: REPO_ROOT,
  serverRoot: SERVER_ROOT,
  get dataDir() {
    return dataDir();
  },
  get sessionPath() {
    return absPath(
      process.env.PLAUD_SESSION_PATH,
      join(dataDir(), "session.json")
    );
  },
  get oauthTokensPath() {
    return absPath(
      process.env.PLAUD_OAUTH_TOKENS_PATH,
      join(dataDir(), "oauth-tokens.json")
    );
  },
  get authMode() {
    const raw = (process.env.PLAUD_AUTH_MODE || "auto").trim().toLowerCase();
    if (raw === "oauth" || raw === "snapshot" || raw === "auto") return raw;
    return "auto";
  },
  get apiMode() {
    const raw = (process.env.PLAUD_API_MODE || "web").trim().toLowerCase();
    if (raw === "official" || raw === "web" || raw === "auto") return raw;
    return "web";
  },
  get plaudOAuthClientId() {
    return (
      process.env.PLAUD_CLI_CLIENT_ID ||
      process.env.PLAUD_CLIENT_ID ||
      "client_f9e0b214-c11f-434b-8b95-c4497d1feb81"
    ).trim();
  },
  get plaudOAuthClientSecret() {
    return (process.env.PLAUD_CLIENT_SECRET || "").trim();
  },
  get plaudOAuthRedirectUri() {
    const port = asInt(process.env.PLAUD_OAUTH_CALLBACK_PORT, 8199);
    return (
      process.env.PLAUD_OAUTH_REDIRECT_URI ||
      `http://localhost:${port}/auth/callback`
    ).trim();
  },
  get plaudOAuthCallbackPort() {
    return asInt(process.env.PLAUD_OAUTH_CALLBACK_PORT, 8199);
  },
  get plaudOAuthLoginTimeoutMs() {
    return asInt(process.env.PLAUD_OAUTH_LOGIN_TIMEOUT_MS, 120_000);
  },
  get plaudOAuthAuthorizationUrl() {
    return (
      process.env.PLAUD_AUTH_URL || "https://web.plaud.ai/platform/oauth"
    ).trim();
  },
  get plaudOAuthTokenUrl() {
    return (
      process.env.PLAUD_TOKEN_URL ||
      "https://platform.plaud.ai/developer/api/oauth/third-party/access-token"
    ).trim();
  },
  get plaudOAuthRefreshUrl() {
    return (
      process.env.PLAUD_REFRESH_URL ||
      "https://platform.plaud.ai/developer/api/oauth/third-party/access-token/refresh"
    ).trim();
  },
  get plaudOfficialApiBase() {
    return (
      process.env.PLAUD_API_BASE || "https://platform.plaud.ai/developer/api"
    ).trim();
  },
  get plaudOAuthExtraHeaders() {
    /** @type {Record<string, string>} */
    const headers = {};
    if (process.env.PLAUD_ENV) headers["x-pld-env"] = process.env.PLAUD_ENV;
    if (process.env.PLAUD_REGION) {
      headers["x-pld-region"] = process.env.PLAUD_REGION;
    }
    return headers;
  },
  get syncIndexPath() {
    return absPath(
      process.env.PLAUD_SYNC_INDEX_PATH,
      join(dataDir(), "sync-index.json")
    );
  },
  get statusPath() {
    return absPath(
      process.env.PLAUD_STATUS_PATH,
      join(dataDir(), "status.json")
    );
  },
  get playwrightProfileDir() {
    return absPath(
      process.env.PLAUD_PLAYWRIGHT_PROFILE_DIR,
      join(dataDir(), "playwright-profile")
    );
  },
  get exportRoot() {
    return absPath(
      process.env.PLAUD_EXPORT_ROOT,
      resolve(REPO_ROOT, "exports")
    );
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
  get telegramBotToken() {
    return (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  },
  get telegramAllowedUsername() {
    const raw = (process.env.TELEGRAM_ALLOWED_USERNAME || "").trim();
    return raw.replace(/^@/, "").toLowerCase();
  },
  get telegramAllowedUserId() {
    const raw = (process.env.TELEGRAM_ALLOWED_USER_ID || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  },
  get botSyncIntervalMin() {
    return asInt(process.env.BOT_SYNC_INTERVAL_MIN, 120);
  },
  get botLongPollSec() {
    return asInt(process.env.BOT_LONG_POLL_SEC, 30);
  },
  get botDataDir() {
    return dataDir();
  },
  get ownerChatPath() {
    return absPath(
      process.env.PLAUD_OWNER_CHAT_PATH,
      join(dataDir(), "owner-chat.json")
    );
  },
  get botSettingsPath() {
    return absPath(
      process.env.PLAUD_BOT_SETTINGS_PATH,
      join(dataDir(), "bot-settings.json")
    );
  },
  get telegramOffsetPath() {
    return absPath(
      process.env.PLAUD_TELEGRAM_OFFSET_PATH,
      join(dataDir(), "telegram-offset.json")
    );
  },
  get treeBrowseStatePath() {
    return absPath(
      process.env.PLAUD_TREE_BROWSE_PATH,
      join(dataDir(), "tree-browse.json")
    );
  },
  get webappHost() {
    return (process.env.WEBAPP_HOST || "127.0.0.1").trim();
  },
  get webappPort() {
    return asInt(process.env.WEBAPP_PORT, 8080);
  },
  get webappBaseUrl() {
    return (process.env.WEBAPP_BASE_URL || "").trim();
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
