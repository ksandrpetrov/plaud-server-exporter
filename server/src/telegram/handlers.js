/**
 * Command + callback routing for the Telegram bot.
 *
 * Stays close to satellite's `handlers.py` design:
 *
 * - `/start` and `/help` answer everyone with a polite "this is private" hint
 *   so accidental tappers don't see silence.
 * - Every other message/callback from a non-owner is silently ignored
 *   (only logged) — same pattern as `USER_CALENDAR_MAP` gate in satellite.
 * - The first authorized `/start` writes `owner-chat.json` so the scheduler
 *   knows where to post unsolicited "scheduled sync" updates.
 * - Inline buttons always `editMessageText` on the same message; we never
 *   fall back to `sendMessage` from a callback handler, otherwise duplicate
 *   callbacks (Telegram retries) would spam the chat.
 */

import { config, effectiveVaultRoot } from "../config/config.js";
import { logger } from "../logger.js";
import {
  isAllowedSender,
  isPrivateChat,
  userIdFromPayload,
  usernameFromPayload,
} from "./auth.js";
import {
  isAllowedInterval,
  loadEffectiveIntervalMin,
  saveBotSettings,
} from "./botSettings.js";
import {
  buildBackToMenuKeyboard,
  buildFilesMenuKeyboard,
  buildMainMenuKeyboard,
  buildSettingsKeyboard,
} from "./keyboards.js";
import {
  CB_BACK,
  CB_CLOSE,
  CB_FILES,
  CB_FILES_STATS,
  CB_FILES_TREE,
  CB_HELP,
  CB_RUN_SYNC,
  CB_SETTINGS,
  CB_SETTINGS_INTERVAL_120,
  CB_SETTINGS_INTERVAL_240,
  CB_SETTINGS_INTERVAL_480,
  CB_SETTINGS_INTERVAL_60,
  CB_STATUS,
  parseFilesTreeFolderCallback,
} from "./callbackData.js";
import {
  BOT_HELP_HTML,
  BOT_UNKNOWN_COMMAND,
  BOT_WELCOME_HTML,
  MENU_CLOSED_TEXT,
  MENU_HEADER,
  SYNC_BUSY_TOAST,
  filesMenuHtml,
  filesStatsHtml,
  lastSyncSummaryLine,
  parseTreeFilePickNumber,
  settingsScreenHtml,
  statusScreenHtml,
} from "./messages.js";
import { SYNC_ACTION_KEY, syncRunGuard } from "./syncGuards.js";
import {
  extractCommandName,
  isHelpCommand,
  isMenuCommand,
  isStartCommand,
  isStatusCommand,
} from "./commandParsers.js";
import { answerBestEffort, editToMenuScreen, safeSend } from "./botMessageUtils.js";
import {
  handleTreeFilePick,
  showFilesTreeFolder,
  showFilesTreeRoot,
} from "./treeBrowse.js";
import { loadOwnerChat, saveOwnerChat } from "./ownerChat.js";
import { readStatus } from "./statusReader.js";
import { scanVaultSummary } from "./vaultTree.js";

const CB_INTERVAL_VALUES = {
  [CB_SETTINGS_INTERVAL_60]: 60,
  [CB_SETTINGS_INTERVAL_120]: 120,
  [CB_SETTINGS_INTERVAL_240]: 240,
  [CB_SETTINGS_INTERVAL_480]: 480,
};

/**
 * @typedef {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   allowedUsername: string;
 *   allowedUserId: number | null;
 *   runManualSync: (params: { chatId: number; loadingMessageId: number | null }) => Promise<unknown>;
 *   runSyncQuiet?: () => Promise<{ status: string }>;
 * }} HandlerContext
 */

/**
 * @param {HandlerContext} ctx
 * @param {object} update
 */
export async function dispatchUpdate(ctx, update) {
  if (update?.message) {
    await handleMessage(ctx, update.message);
    return;
  }
  if (update?.callback_query) {
    await handleCallbackQuery(ctx, update.callback_query);
  }
}

async function handleMessage(ctx, message) {
  const text = String(message?.text || "").trim();
  if (!text) return;
  const chatId = Number(message?.chat?.id);
  if (!Number.isInteger(chatId)) return;

  if (!isPrivateChat(message.chat)) {
    logger.info("Silently ignored non-private chat message", {
      chatType: String(message?.chat?.type || ""),
      chatId,
      username: usernameFromPayload(message.from),
    });
    return;
  }

  const allowed = isAllowedSender({
    from: message.from,
    allowedUserId: ctx.allowedUserId,
    allowedUsername: ctx.allowedUsername,
  });

  if (!allowed) {
    logger.info("Silently ignored message from foreign sender", {
      userId: userIdFromPayload(message.from),
      username: usernameFromPayload(message.from),
      chatId,
      command: extractCommandName(text),
    });
    return;
  }

  if (isStartCommand(text)) {
    await handleStart(ctx, {
      chatId,
      from: message.from,
    });
    return;
  }
  if (isHelpCommand(text)) {
    await safeSend(ctx, chatId, BOT_HELP_HTML);
    return;
  }
  if (isMenuCommand(text)) {
    await openMenu(ctx, chatId);
    return;
  }
  if (isStatusCommand(text)) {
    await sendStatusMessage(ctx, chatId);
    return;
  }

  const treePick = parseTreeFilePickNumber(text);
  if (treePick !== null) {
    await handleTreeFilePick(ctx, { chatId, pick: treePick });
    return;
  }

  await safeSend(ctx, chatId, BOT_UNKNOWN_COMMAND);
}

async function handleCallbackQuery(ctx, callback) {
  const chatId = Number(callback?.message?.chat?.id);
  const messageId = Number(callback?.message?.message_id);
  const data = String(callback?.data || "");

  if (!Number.isInteger(chatId) || !Number.isInteger(messageId)) {
    await answerBestEffort(ctx, callback);
    return;
  }
  if (!isPrivateChat(callback?.message?.chat)) {
    logger.info("Silently ignored non-private callback", {
      chatType: String(callback?.message?.chat?.type || ""),
      chatId,
      data,
    });
    await answerBestEffort(ctx, callback);
    return;
  }
  const allowed = isAllowedSender({
    from: callback.from,
    allowedUserId: ctx.allowedUserId,
    allowedUsername: ctx.allowedUsername,
  });
  if (!allowed) {
    logger.info("Silently ignored callback from foreign sender", {
      userId: userIdFromPayload(callback.from),
      username: usernameFromPayload(callback.from),
      chatId,
      data,
    });
    await answerBestEffort(ctx, callback);
    return;
  }

  let callbackAnswered = false;
  try {
    callbackAnswered = await routeCallback(ctx, {
      chatId,
      messageId,
      data,
      callback,
    });
  } catch (err) {
    logger.error("Callback handler failed", {
      data,
      error: String(err?.message || err),
    });
  } finally {
    if (!callbackAnswered) {
      await answerBestEffort(ctx, callback);
    }
  }
}

/**
 * @returns {Promise<boolean>} true when answerCallbackQuery was already sent
 */
async function routeCallback(ctx, { chatId, messageId, data, callback }) {
  if (data === CB_RUN_SYNC) {
    if (!syncRunGuard.tryAcquire(chatId, SYNC_ACTION_KEY)) {
      await answerBestEffort(ctx, callback, { text: SYNC_BUSY_TOAST });
      return true;
    }
    await ctx.runManualSync({ chatId, loadingMessageId: messageId });
    return false;
  }
  if (data === CB_STATUS) {
    const status = await readStatus();
    await editToMenuScreen(ctx, {
      chatId,
      messageId,
      text: statusScreenHtml(status),
      keyboard: buildBackToMenuKeyboard(),
    });
    return;
  }
  if (data === CB_FILES) {
    await editToMenuScreen(ctx, {
      chatId,
      messageId,
      text: filesMenuHtml(),
      keyboard: buildFilesMenuKeyboard(),
    });
    return;
  }
  if (data === CB_FILES_TREE) {
    await showFilesTreeRoot(ctx, { chatId, messageId });
    return;
  }
  const folderHit = parseFilesTreeFolderCallback(data);
  if (folderHit) {
    await showFilesTreeFolder(ctx, {
      chatId,
      messageId,
      folderIndex: folderHit.folderIndex,
      page: folderHit.page,
    });
    return;
  }
  if (data === CB_FILES_STATS) {
    const stats = await scanVaultSummary({
      vaultRoot: effectiveVaultRoot(),
      subfolder: config.obsidianSubfolder,
    });
    await editToMenuScreen(ctx, {
      chatId,
      messageId,
      text: filesStatsHtml(stats),
      keyboard: buildBackToMenuKeyboard(),
    });
    return;
  }
  if (data === CB_SETTINGS) {
    const intervalMin = await loadEffectiveIntervalMin();
    const status = await readStatus();
    await editToMenuScreen(ctx, {
      chatId,
      messageId,
      text: settingsScreenHtml({
        intervalMin,
        lastSyncAt: status?.lastSyncAt || null,
      }),
      keyboard: buildSettingsKeyboard(intervalMin),
    });
    return;
  }
  if (data in CB_INTERVAL_VALUES) {
    await handleSetInterval(ctx, {
      chatId,
      messageId,
      intervalMin: CB_INTERVAL_VALUES[data],
    });
    return;
  }
  if (data === CB_BACK) {
    await openMenuAtMessage(ctx, { chatId, messageId });
    return;
  }
  if (data === CB_HELP) {
    await editToMenuScreen(ctx, {
      chatId,
      messageId,
      text: BOT_HELP_HTML,
      keyboard: buildBackToMenuKeyboard(),
    });
    return;
  }
  if (data === CB_CLOSE) {
    await editToMenuScreen(ctx, {
      chatId,
      messageId,
      text: MENU_CLOSED_TEXT,
      keyboard: null,
    });
    return;
  }
  logger.info("Unknown callback_data", { data });
  return false;
}

async function handleStart(ctx, { chatId, from }) {
  const username = usernameFromPayload(from);
  const userId = userIdFromPayload(from);
  try {
    const result = await saveOwnerChat({ chatId, username, userId });
    if (result.status === "saved") {
      logger.info("Captured owner chat", { chatId, username, userId });
    } else if (result.status === "rejected") {
      logger.warn(
        "Refused to overwrite owner-chat.json with a different chat id",
        {
          existingChatId: result.existing?.chatId,
          incomingChatId: chatId,
          existingUserId: result.existing?.userId ?? null,
          incomingUserId: userId,
        }
      );
    }
  } catch (err) {
    logger.warn("Failed to persist owner chat", {
      error: String(err?.message || err),
    });
  }
  await safeSend(ctx, chatId, BOT_WELCOME_HTML, {
    replyMarkup: buildMainMenuKeyboard(),
  });
}

async function openMenu(ctx, chatId) {
  const status = await readStatus();
  const text = `${MENU_HEADER}\n\n${lastSyncSummaryLine(status)}\n\nВыбери действие:`;
  await safeSend(ctx, chatId, text, { replyMarkup: buildMainMenuKeyboard() });
}

async function openMenuAtMessage(ctx, { chatId, messageId }) {
  const status = await readStatus();
  const text = `${MENU_HEADER}\n\n${lastSyncSummaryLine(status)}\n\nВыбери действие:`;
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text,
    keyboard: buildMainMenuKeyboard(),
  });
}

async function sendStatusMessage(ctx, chatId) {
  const status = await readStatus();
  await safeSend(ctx, chatId, statusScreenHtml(status), {
    replyMarkup: buildBackToMenuKeyboard(),
  });
}

async function handleSetInterval(ctx, { chatId, messageId, intervalMin }) {
  if (!isAllowedInterval(intervalMin)) {
    logger.info("Ignored unsupported interval value", { intervalMin });
    return;
  }
  try {
    await saveBotSettings({ intervalMin });
    logger.info("Updated bot interval", { intervalMin });
  } catch (err) {
    logger.warn("Failed to persist bot settings", {
      error: String(err?.message || err),
    });
    return;
  }
  const status = await readStatus();
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: settingsScreenHtml({
      intervalMin,
      lastSyncAt: status?.lastSyncAt || null,
    }),
    keyboard: buildSettingsKeyboard(intervalMin),
  });
}

export {
  isHelpCommand,
  isMenuCommand,
  isStartCommand,
  isStatusCommand,
} from "./commandParsers.js";

export async function ownerChatId() {
  const record = await loadOwnerChat();
  return record?.chatId ?? null;
}
