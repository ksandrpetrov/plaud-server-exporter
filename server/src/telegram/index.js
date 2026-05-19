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
import { logger } from "../logger.js";
import { redactError } from "../security/redact.js";
import { TelegramBotLoop } from "./bot.js";
import { BotScheduler } from "./scheduler.js";
import { TelegramClient } from "./telegramClient.js";
import { runSyncWithReporting } from "./syncOrchestrator.js";

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

  if (!token) {
    logger.error(
      "Telegram bot disabled: TELEGRAM_BOT_TOKEN is empty. Set it in .env to enable the bot."
    );
    return 2;
  }
  if (!allowedUsername) {
    logger.error(
      "Telegram bot misconfigured: TELEGRAM_ALLOWED_USERNAME is empty. Set it in .env."
    );
    return 2;
  }

  const telegram = new TelegramClient(token);
  await registerMenuCommandsSafely(telegram);

  let inFlightSyncs = 0;
  const runManualSync = async ({ chatId, loadingMessageId }) => {
    inFlightSyncs++;
    try {
      return await runSyncWithReporting({
        telegram,
        chatId,
        loadingMessageId,
        source: "manual",
      });
    } finally {
      inFlightSyncs--;
    }
  };
  const runScheduledSync = async ({ chatId }) => {
    if (inFlightSyncs > 0) {
      logger.info(
        "Skipping scheduled sync — another sync is already running in this process"
      );
      return;
    }
    inFlightSyncs++;
    try {
      return await runSyncWithReporting({
        telegram,
        chatId,
        loadingMessageId: null,
        source: "scheduled",
      });
    } finally {
      inFlightSyncs--;
    }
  };

  const scheduler = new BotScheduler({
    telegram,
    runOrchestrator: runScheduledSync,
  });

  const loop = new TelegramBotLoop({
    telegram,
    allowedUsername,
    longPollSec: config.botLongPollSec,
    runManualSync,
    scheduler,
  });

  installSignalHandlers(loop);

  try {
    await loop.run();
    return 0;
  } catch (err) {
    logger.error("Bot loop crashed", redactError(err));
    await loop.shutdown();
    return 1;
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
