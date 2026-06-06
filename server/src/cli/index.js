#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { config, effectiveVaultRoot } from "../config/config.js";
import { logger } from "../logger.js";
import { redactError } from "../security/redact.js";
import {
  loadPlaudSessionFromSnapshotDetailed,
  logCliSessionLoadFailure,
  describeAuthState,
} from "../auth/loadPlaudSession.js";
import {
  removeSessionSnapshot,
  sessionFileInfo,
} from "../auth/sessionStore.js";
import { oauthTokensFileInfo } from "../auth/oauthTokenStore.js";
import { describeSnapshot } from "../auth/plaudSessionExtractor.js";
import { validateSession } from "../plaud/plaudApiClient.js";
import { runSync } from "../sync/syncRunner.js";
import { readStatus } from "../sync/statusReader.js";
import { syncIndexInfo } from "../sync/serverSyncIndex.js";
import { errorsDirectoryInfo, reportError } from "../errors/errorReporter.js";
import {
  classifySyncFailure,
  recordAuthFailureIfNeeded,
  SYNC_FAILURE_AUTH,
  SYNC_FAILURE_LOCK,
  SYNC_FAILURE_PLAUD_CHANGED,
} from "../sync/syncFailureMapper.js";

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > -1) {
        args.flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          args.flags[token.slice(2)] = next;
          i++;
        } else {
          args.flags[token.slice(2)] = true;
        }
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: plaud-server-exporter <command> [flags]",
      "",
      "Commands:",
      "  auth                Interactive Plaud login (OAuth by default; see flags).",
      "    --playwright        Legacy login via Playwright snapshot (session.json).",
      "    --oauth             Force OAuth browser login (oauth-tokens.json).",
      "",
      "  sync                Pull summaries from Plaud and write Markdown.",
      "    --dry-run           Do not write files or update the sync index.",
      "",
      "  status              Print configuration, session presence, and last sync stats.",
      "",
      "  bot                 Run the Telegram bot (long-polling). Owns the schedule",
      "                      and reports every sync. Requires TELEGRAM_BOT_TOKEN and",
      "                      TELEGRAM_ALLOWED_USERNAME in .env.",
      "",
      "  logout              Remove saved credentials (OAuth tokens and/or snapshot).",
      "",
      "  help                Print this message.",
      "",
      "Auth/API env: PLAUD_AUTH_MODE=auto|oauth|snapshot, PLAUD_API_MODE=web|official|auto",
      "",
    ].join("\n")
  );
}

async function commandAuth(flags = {}) {
  const usePlaywright = !!flags.playwright || config.authMode === "snapshot";
  const useOAuth =
    !!flags.oauth || config.authMode === "oauth" || !usePlaywright;

  if (useOAuth && !usePlaywright) {
    const { runInteractiveOAuthLogin } = await import("../auth/plaudOAuth.js");
    await runInteractiveOAuthLogin();
  } else {
    const { runInteractiveLogin } = await import("../auth/playwrightAuth.js");
    await runInteractiveLogin({ headless: false });
  }

  const { session, status } = await loadPlaudSessionFromSnapshotDetailed({
    logContext: "cli:auth",
  });
  if (!session) {
    logCliSessionLoadFailure(status === "missing" ? "missing" : "invalid", {
      missing: "Login finished but no credentials were saved.",
      invalid: "Login finished but credentials are unusable.",
    });
    process.exitCode = 2;
    return;
  }
  const count = await validateSession(session);
  logger.info("Session validated against Plaud API.", {
    recordsVisible: count,
    authMode: session.authMode,
    apiMode: session.apiMode,
  });
}

async function commandSync(flags) {
  const { session, status } = await loadPlaudSessionFromSnapshotDetailed({
    logContext: "cli:sync",
  });
  if (!session) {
    logCliSessionLoadFailure(status === "missing" ? "missing" : "invalid", {
      missing:
        "No Plaud credentials found. Run `npm run server:auth` first (OAuth or Playwright).",
      invalid: "Failed to read Plaud credentials.",
    });
    process.exitCode = 2;
    return;
  }

  const dryRun = !!flags["dry-run"];

  try {
    const stats = await runSync({ session, dryRun });
    logger.info("Sync complete.", stats);
  } catch (error) {
    const failure = classifySyncFailure(error);
    if (failure.kind === SYNC_FAILURE_LOCK) {
      logger.error(
        "Another plaud-server-exporter sync is already running. Skipping this run.",
        failure.lockInfo
      );
      process.exitCode = failure.exitCode;
      return;
    }
    if (failure.kind === SYNC_FAILURE_AUTH) {
      await recordAuthFailureIfNeeded(failure, error);
      await reportError(error, { stage: "auth", dryRun });
      logger.error(
        "Plaud session is no longer accepted by the API. Re-run `npm run server:auth`."
      );
      process.exitCode = failure.exitCode;
      return;
    }
    if (!dryRun) {
      await reportError(error, { stage: "sync", dryRun: false });
    }
    logger.errorFrom("Sync failed.", error);
    if (failure.kind === SYNC_FAILURE_PLAUD_CHANGED) {
      logger.error("Plaud may have changed its API — manual review required.");
    }
    process.exitCode = failure.exitCode;
  }
}

async function commandBot() {
  const { runBot } = await import("../telegram/index.js");
  const code = await runBot();
  if (code) process.exitCode = code;
}

async function commandStatus() {
  const sessionFile = await sessionFileInfo();
  const oauthFile = await oauthTokensFileInfo();
  const authState = await describeAuthState();
  const {
    status: sessionLoadStatus,
    snapshot,
    authSource,
  } = await loadPlaudSessionFromSnapshotDetailed({
    logContext: "cli:status",
    includeSnapshot: true,
  });
  const sessionDescription = describeSnapshot(snapshot);
  const index = await syncIndexInfo();
  const status = await readStatus();

  const errorsDir = await errorsDirectoryInfo();

  const summary = {
    config: {
      vaultRoot: effectiveVaultRoot(),
      obsidianSubfolder: config.obsidianSubfolder,
      exportRoot: config.exportRoot,
      authMode: config.authMode,
      apiMode: config.apiMode,
      sessionPath: config.sessionPath,
      oauthTokensPath: config.oauthTokensPath,
      syncIndexPath: config.syncIndexPath,
      errorsDir: errorsDir.path,
      playwrightProfileDir: config.playwrightProfileDir,
      timezone: config.timezone,
      mode: "summary-only",
    },
    auth: authState,
    session: {
      fileInfo: sessionFile,
      oauthFileInfo: oauthFile,
      snapshot: sessionDescription,
      loadStatus: sessionLoadStatus,
      authSource: authSource || null,
      apiReady: sessionLoadStatus === "ok",
    },
    syncIndex: index,
    errors: errorsDir,
    lastStatus: status,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "help";

  try {
    switch (cmd) {
      case "auth":
        await commandAuth(args.flags);
        break;
      case "sync":
        await commandSync(args.flags);
        break;
      case "status":
        await commandStatus();
        break;
      case "bot":
        await commandBot();
        break;
      case "logout": {
        const { revokeOAuthSession } = await import("../auth/plaudOAuth.js");
        await revokeOAuthSession();
        await removeSessionSnapshot();
        logger.info("OAuth tokens and session snapshot removed.");
        break;
      }
      case "help":
      case "--help":
      case "-h":
        printUsage();
        break;
      default:
        process.stderr.write(`Unknown command: ${cmd}\n\n`);
        printUsage();
        process.exitCode = 1;
    }
  } catch (error) {
    logger.errorFrom(`Command \`${cmd}\` failed.`, error);
    // Stringify redacted error to non-zero exit code so systemd reports failure.
    const redacted = redactError(error);
    process.stderr.write(`${JSON.stringify(redacted)}\n`);
    process.exitCode = process.exitCode || 1;
  }
}

function isEntryScript() {
  if (!process.argv[1]) return false;
  try {
    const here = fileURLToPath(import.meta.url);
    return realpathSync(process.argv[1]) === realpathSync(here);
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  main();
}
