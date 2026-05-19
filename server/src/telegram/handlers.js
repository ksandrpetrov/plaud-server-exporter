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

import { access } from "node:fs/promises";
import { config, effectiveVaultRoot } from "../config/config.js";
import { logger } from "../logger.js";
import { loadSyncIndex } from "../sync/serverSyncIndex.js";
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
  buildFilesTreeFolderKeyboard,
  buildFilesTreeRootKeyboard,
  buildMainMenuKeyboard,
  buildSettingsKeyboard,
} from "./keyboards.js";
import {
  BOT_HELP_HTML,
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
  parseTreeFilePickNumber,
  settingsScreenHtml,
  statusScreenHtml,
  TREE_FILE_PICK_MISSING_ON_DISK_HTML,
  TREE_FILE_PICK_NOT_SYNCED_HTML,
  TREE_FILE_PICK_NO_CONTEXT_HTML,
  treeFilePickOutOfRangeHtml,
} from "./messages.js";
import {
  clearTreeBrowseState,
  getTreeBrowseState,
  setTreeBrowseState,
  treeBrowseItemAtPick,
} from "./treeBrowseState.js";
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
 *   allowedUserId: number | null;
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
  clearTreeBrowseState(chatId);
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
  setTreeBrowseState(chatId, {
    folderIndex: folderPage.folderIndex,
    page: folderPage.page,
    items: folderPage.items,
  });
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: filesTreeFolderHtml(folderPage),
    keyboard: buildFilesTreeFolderKeyboard(folderPage),
  });
}

async function handleTreeFilePick(ctx, { chatId, pick }) {
  const state = getTreeBrowseState(chatId);
  if (!state?.items?.length) {
    await safeSend(ctx, chatId, TREE_FILE_PICK_NO_CONTEXT_HTML);
    return;
  }
  const item = treeBrowseItemAtPick(state, pick);
  if (!item) {
    await safeSend(ctx, chatId, treeFilePickOutOfRangeHtml(pick, state.items.length));
    return;
  }
  const summaryPath = String(item.summaryPath || "").trim();
  if (!summaryPath) {
    await safeSend(ctx, chatId, TREE_FILE_PICK_NOT_SYNCED_HTML);
    return;
  }
  try {
    await access(summaryPath);
  } catch {
    await safeSend(ctx, chatId, TREE_FILE_PICK_MISSING_ON_DISK_HTML);
    return;
  }
  try {
    await ctx.telegram.sendDocument({ chatId, documentPath: summaryPath });
  } catch (err) {
    logger.warn("sendDocument failed", {
      path: summaryPath,
      error: String(err?.message || err),
    });
    await safeSend(ctx, chatId, TREE_FILE_PICK_MISSING_ON_DISK_HTML);
  }
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

/**
 * Returns a short, log-safe label for the incoming message: the first
 * `/command` token if any, otherwise the literal `text` truncated to 32
 * chars. We only log this for foreign senders, so it never contains the
 * owner's free-text input.
 *
 * @param {string} text
 * @returns {string}
 */
function extractCommandName(text) {
  const head = COMMAND_HEAD(text);
  if (head.startsWith("/")) return head.slice(0, 32);
  return String(text || "").slice(0, 32);
}

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
