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
import { loadSyncIndex } from "../sync/serverSyncIndex.js";
import { isAllowedUsername, usernameFromPayload } from "./auth.js";
import {
  isAllowedInterval,
  loadEffectiveIntervalMin,
  saveBotSettings,
} from "./botSettings.js";
import {
  buildBackToMenuKeyboard,
  buildFilesMenuKeyboard,
  buildFilesTreeFolderKeyboard,
  buildFilesTreeRootKeyboard,
  buildMainMenuKeyboard,
  buildSettingsKeyboard,
} from "./keyboards.js";
import {
  BOT_HELP_HTML,
  BOT_PRIVATE_HINT,
  BOT_UNKNOWN_COMMAND,
  BOT_WELCOME_HTML,
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
  MENU_CLOSED_TEXT,
  MENU_HEADER,
  filesMenuHtml,
  filesStatsHtml,
  filesTreeFolderHtml,
  filesTreeRootHtml,
  lastSyncSummaryLine,
  parseFilesTreeFolderCallback,
  settingsScreenHtml,
  statusScreenHtml,
} from "./messages.js";
import { loadOwnerChat, saveOwnerChat } from "./ownerChat.js";
import { loadPlaudLiveSyncTree } from "./plaudLiveTree.js";
import { readStatus } from "./statusReader.js";
import {
  buildSyncIndexFolderPage,
  buildSyncIndexTreeRoot,
  scanVaultSummary,
} from "./vaultTree.js";

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
 *   runManualSync: (params: { chatId: number; loadingMessageId: number | null }) => Promise<unknown>;
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
  const username = usernameFromPayload(message.from);

  if (isStartCommand(text)) {
    await handleStart(ctx, { chatId, username });
    return;
  }
  if (isHelpCommand(text)) {
    await safeSend(ctx, chatId, BOT_HELP_HTML);
    return;
  }

  if (!isAllowedUsername(username, ctx.allowedUsername)) {
    logger.info("Silently ignored message from foreign user", {
      username,
      chatId,
    });
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

  await safeSend(ctx, chatId, BOT_UNKNOWN_COMMAND);
}

async function handleCallbackQuery(ctx, callback) {
  const chatId = Number(callback?.message?.chat?.id);
  const messageId = Number(callback?.message?.message_id);
  const username = usernameFromPayload(callback.from);
  const data = String(callback?.data || "");

  if (!Number.isInteger(chatId) || !Number.isInteger(messageId)) {
    await answerBestEffort(ctx, callback);
    return;
  }
  if (!isAllowedUsername(username, ctx.allowedUsername)) {
    logger.info("Silently ignored callback from foreign user", {
      username,
      chatId,
      data,
    });
    await answerBestEffort(ctx, callback);
    return;
  }

  try {
    await routeCallback(ctx, { chatId, messageId, data });
  } catch (err) {
    logger.error("Callback handler failed", {
      data,
      error: String(err?.message || err),
    });
  } finally {
    await answerBestEffort(ctx, callback);
  }
}

async function routeCallback(ctx, { chatId, messageId, data }) {
  if (data === CB_RUN_SYNC) {
    await ctx.runManualSync({ chatId, loadingMessageId: messageId });
    return;
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
}

async function handleStart(ctx, { chatId, username }) {
  const allowed = isAllowedUsername(username, ctx.allowedUsername);
  if (allowed) {
    try {
      await saveOwnerChat({ chatId, username });
      logger.info("Captured owner chat", { chatId, username });
    } catch (err) {
      logger.warn("Failed to persist owner chat", {
        error: String(err?.message || err),
      });
    }
    await safeSend(ctx, chatId, BOT_WELCOME_HTML, {
      replyMarkup: buildMainMenuKeyboard(),
    });
    return;
  }
  await safeSend(ctx, chatId, BOT_PRIVATE_HINT);
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

/**
 * Returns a sync-index-shaped object to feed the tree builders. Prefers a
 * live Plaud snapshot (so folder counts match Plaud's sidebar verbatim) and
 * falls back to the on-disk sync-index when Plaud is unreachable or no
 * session is stored. Live records carry the real `folderSegment` from the
 * filetag list, so legacy data with empty `folderSegment` still buckets
 * correctly.
 */
async function loadTreeSource() {
  const real = await loadSyncIndex();
  try {
    const live = await loadPlaudLiveSyncTree({ syncIndex: real });
    if (live && Object.keys(live.records || {}).length > 0) return live;
  } catch (err) {
    logger.warn("Live Plaud tree failed; using sync-index", {
      error: String(err?.message || err),
    });
  }
  return real;
}

async function showFilesTreeRoot(ctx, { chatId, messageId }) {
  const idx = await loadTreeSource();
  const root = buildSyncIndexTreeRoot(idx, {
    vaultRoot: effectiveVaultRoot(),
    subfolder: config.obsidianSubfolder,
  });
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: filesTreeRootHtml(root),
    keyboard: buildFilesTreeRootKeyboard(root),
  });
}

async function showFilesTreeFolder(ctx, { chatId, messageId, folderIndex, page }) {
  const idx = await loadTreeSource();
  const folderPage = buildSyncIndexFolderPage(idx, {
    folderIndex,
    page,
    vaultRoot: effectiveVaultRoot(),
    subfolder: config.obsidianSubfolder,
  });
  if (!folderPage.exists) {
    await showFilesTreeRoot(ctx, { chatId, messageId });
    return;
  }
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: filesTreeFolderHtml(folderPage),
    keyboard: buildFilesTreeFolderKeyboard(folderPage),
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

async function editToMenuScreen(ctx, { chatId, messageId, text, keyboard }) {
  try {
    await ctx.telegram.editMessageText({
      chatId,
      messageId,
      text,
      replyMarkup: keyboard,
    });
  } catch (err) {
    logger.info("Edit callback message ignored", {
      error: String(err?.message || err),
    });
  }
}

async function safeSend(ctx, chatId, text, options = {}) {
  try {
    await ctx.telegram.sendMessage({
      chatId,
      text,
      replyMarkup: options.replyMarkup ?? null,
    });
  } catch (err) {
    logger.warn("sendMessage failed", {
      error: String(err?.message || err),
    });
  }
}

async function answerBestEffort(ctx, callback) {
  const id = String(callback?.id || "");
  if (!id) return;
  try {
    await ctx.telegram.answerCallbackQuery({ callbackQueryId: id });
  } catch (err) {
    logger.info("answerCallbackQuery failed", {
      error: String(err?.message || err),
    });
  }
}

// --- pure command parsers (exported for tests) -----------------------------

const COMMAND_HEAD = (raw) => String(raw || "").trim().split(/\s+/)[0].toLowerCase();
const COMMAND_RE = (name) => new RegExp(`^/${name}(?:@[a-z0-9_]+)?$`);

export function isStartCommand(text) {
  return COMMAND_RE("start").test(COMMAND_HEAD(text));
}

export function isHelpCommand(text) {
  return COMMAND_RE("help").test(COMMAND_HEAD(text));
}

export function isMenuCommand(text) {
  return COMMAND_RE("menu").test(COMMAND_HEAD(text));
}

export function isStatusCommand(text) {
  return COMMAND_RE("status").test(COMMAND_HEAD(text));
}

export async function ownerChatId() {
  const record = await loadOwnerChat();
  return record?.chatId ?? null;
}
