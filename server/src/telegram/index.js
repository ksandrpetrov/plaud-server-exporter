/**
 * Top-level bot entrypoint.
 *
 * Wires together the Telegram client, handlers, scheduler, and sync
 * orchestrator. Called from `server/src/cli/index.js` (`bot` command) and
 * normally launched as a long-running systemd service.
 *
 * Wiring order on startup:
 *
 * 1. Validate `.env` (token + allowed username present).
 * 2. Register Telegram menu commands (best-effort: a 502 on `setMyCommands`
 *    must not stop us from receiving updates).
 * 3. Install SIGINT/SIGTERM handlers so systemd can shut us down cleanly.
 * 4. Start the scheduler (waits 60 s before its first tick).
 * 5. Run the long-polling loop until shutdown.
 */

import { config } from "../config/config.js";
import { startWebServer, stopWebServer } from "../http/webServer.js";
import { logger } from "../logger.js";
import { redactError } from "../security/redact.js";
import { TelegramBotLoop } from "./bot.js";
import { createMessageAnimator } from "./messageAnimator.js";
import { logPersistenceDiagnostics } from "./persistenceDiagnostics.js";
import { BotScheduler } from "./scheduler.js";
import { TelegramClient } from "./telegramClient.js";
import { SYNC_ACTION_KEY, syncRunGuard } from "./syncGuards.js";
import { runSyncSilent, runSyncWithReporting } from "./syncOrchestrator.js";

const MENU_COMMANDS = [
  { command: "menu", description: "Главное меню" },
  { command: "status", description: "Статус последнего синка" },
  { command: "help", description: "Справка" },
];

/**
 * @returns {Promise<number>} process exit code
 */
export async function runBot() {
  const token = config.telegramBotToken;
  const allowedUsername = config.telegramAllowedUsername;
  const allowedUserId = config.telegramAllowedUserId;

  if (!token) {
    logger.error(
      "Telegram bot disabled: TELEGRAM_BOT_TOKEN is empty. Set it in .env to enable the bot."
    );
    return 2;
  }
  if (!allowedUsername && !allowedUserId) {
    logger.error(
      "Telegram bot misconfigured: set TELEGRAM_ALLOWED_USER_ID (recommended) and/or TELEGRAM_ALLOWED_USERNAME in .env."
    );
    return 2;
  }
  if (!allowedUserId) {
    logger.warn(
      "TELEGRAM_ALLOWED_USER_ID is not set — falling back to username-only auth. " +
        "Telegram usernames can be released and re-claimed by other accounts; " +
        "add TELEGRAM_ALLOWED_USER_ID to .env for a stable identity check."
    );
  }

  await logPersistenceDiagnostics();
  await startWebServer();

  const telegram = new TelegramClient(token);
  await registerMenuCommandsSafely(telegram);

  const messageAnimator = createMessageAnimator({ telegram });

  const runManualSync = async ({ chatId, loadingMessageId }) =>
    runSyncWithReporting({
      telegram,
      chatId,
      loadingMessageId,
      source: "manual",
    });

  const runScheduledSync = async ({ chatId }) => {
    if (!syncRunGuard.tryAcquire(chatId, SYNC_ACTION_KEY)) {
      logger.info(
        "Skipping scheduled sync — ActionGuard busy or post-success cooldown"
      );
      return;
    }
    return runSyncWithReporting({
      telegram,
      chatId,
      loadingMessageId: null,
      source: "scheduled",
    });
  };

  const runSyncQuiet = async ({ chatId } = {}) =>
    runSyncSilent({ chatId: chatId ?? null });

  const scheduler = new BotScheduler({
    telegram,
    runOrchestrator: runScheduledSync,
  });

  const loop = new TelegramBotLoop({
    telegram,
    allowedUsername,
    allowedUserId,
    longPollSec: config.botLongPollSec,
    runManualSync,
    runSyncQuiet,
    scheduler,
    messageAnimator,
  });

  installSignalHandlers(loop);

  try {
    await loop.run();
    return 0;
  } catch (err) {
    logger.error("Bot loop crashed", redactError(err));
    await loop.shutdown();
    return 1;
  } finally {
    await stopWebServer().catch(() => {});
  }
}

async function registerMenuCommandsSafely(telegram) {
  try {
    await telegram.setMyCommands(MENU_COMMANDS);
  } catch (err) {
    logger.warn("setMyCommands failed; continuing without bot menu", {
      error: String(err?.message || err),
    });
  }
}

function installSignalHandlers(loop) {
  let shuttingDown = false;
  const onSignal = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Received signal, shutting down bot", { signal });
    loop.shutdown().catch((err) => {
      logger.warn("Shutdown error", { error: String(err?.message || err) });
    });
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}
