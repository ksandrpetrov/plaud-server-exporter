#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { config, effectiveVaultRoot } from "../config/config.js";
import { logger } from "../logger.js";
import { redactError } from "../security/redact.js";
import {
  loadSessionSnapshot,
  sessionFileInfo,
  removeSessionSnapshot,
} from "../auth/sessionStore.js";
import {
  assertSnapshotReadyForApi,
  createSessionFromSnapshot,
  describeSnapshot,
} from "../auth/plaudSessionExtractor.js";
import { validateSession } from "../plaud/plaudApiClient.js";
import { runSync, recordAuthError } from "../sync/syncRunner.js";
import { syncIndexInfo } from "../sync/serverSyncIndex.js";
import { reportError, errorsDirectoryInfo } from "../errors/errorReporter.js";
import {
  classifySyncFailure,
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
      "  auth                Interactive Plaud login via Playwright; saves a session snapshot.",
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
      "  logout              Remove the saved session snapshot (keeps Playwright profile).",
      "",
      "  help                Print this message.",
      "",
    ].join("\n")
  );
}

async function commandAuth() {
  const { runInteractiveLogin } = await import("../auth/playwrightAuth.js");
  await runInteractiveLogin({ headless: false });

  const snapshot = await loadSessionSnapshot();
  assertSnapshotReadyForApi(snapshot);
  const session = createSessionFromSnapshot(snapshot);
  const count = await validateSession(session);
  logger.info("Session validated against Plaud API.", { recordsVisible: count });
}

async function commandSync(flags) {
  const snapshot = await loadSessionSnapshot();
  if (!snapshot) {
    logger.error("No session snapshot found. Run `npm run server:auth` first.");
    process.exitCode = 2;
    return;
  }
  let session;
  try {
    session = createSessionFromSnapshot(snapshot);
  } catch (error) {
    logger.errorFrom("Failed to read Plaud session from snapshot.", error);
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
      await recordAuthError(error.message);
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
  const session = await sessionFileInfo();
  const snapshot = session.exists ? await loadSessionSnapshot() : null;
  const sessionDescription = describeSnapshot(snapshot);
  const index = await syncIndexInfo();
  let status = null;
  try {
    status = JSON.parse(await readFile(config.statusPath, "utf8"));
  } catch {
    status = null;
  }

  const errorsDir = await errorsDirectoryInfo();

  const summary = {
    config: {
      vaultRoot: effectiveVaultRoot(),
      obsidianSubfolder: config.obsidianSubfolder,
      exportRoot: config.exportRoot,
      sessionPath: config.sessionPath,
      syncIndexPath: config.syncIndexPath,
      errorsDir: errorsDir.path,
      playwrightProfileDir: config.playwrightProfileDir,
      timezone: config.timezone,
      mode: "summary-only",
    },
    session: { fileInfo: session, snapshot: sessionDescription },
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
        await commandAuth();
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
      case "logout":
        await removeSessionSnapshot();
        logger.info("Session snapshot removed.");
        break;
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
