import { logger } from "../../logger.js";
import {
  CB_BACK,
  CB_BACK_FILES,
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
  CB_SETTINGS_TOGGLE_SUMMARY,
  CB_STATUS,
} from "../callbackData.js";
import { buildBackToMenuKeyboard } from "../keyboards.js";
import {
  BOT_HELP_HTML,
  BOT_HELP_RICH_MARKDOWN,
  humanIntervalLabel,
  statusScreenHtml,
  statusScreenRichMarkdown,
  syncBusyText,
} from "../messages.js";
import {
  loadBotSettings,
  loadEffectiveIntervalMin,
  saveBotSettings,
} from "../botSettings.js";
import {
  answerBestEffort,
  safeCallbackRichScreen,
} from "../botMessageUtils.js";
import { readStatus } from "../../sync/statusReader.js";
import { SYNC_ACTION_MANUAL, syncRunGuard } from "../syncGuards.js";
import {
  handleFilesCallback,
  handleFilesStatsCallback,
  handleFilesTreeCallback,
  routeFilesTreeCallback,
} from "./filesTree.js";
import {
  handleSetInterval,
  openMenuAtMessage,
  renderSettingsScreen,
} from "./menu.js";

const CB_INTERVAL_VALUES = {
  [CB_SETTINGS_INTERVAL_60]: 60,
  [CB_SETTINGS_INTERVAL_120]: 120,
  [CB_SETTINGS_INTERVAL_240]: 240,
  [CB_SETTINGS_INTERVAL_480]: 480,
};

async function handleRunSyncCallback({ ctx, chatId, messageId, callback }) {
  if (!syncRunGuard.tryAcquire(chatId, SYNC_ACTION_MANUAL)) {
    const busy = syncBusyText("manual");
    await answerBestEffort(ctx, callback, { text: busy, showAlert: true });
    return true;
  }
  await ctx.runManualSync({ chatId, loadingMessageId: messageId });
  return false;
}

async function handleStatusCallback({ ctx, chatId, messageId }) {
  const status = await readStatus();
  await safeCallbackRichScreen(ctx, {
    chatId,
    messageId,
    richMarkdown: statusScreenRichMarkdown(status),
    fallbackHtml: statusScreenHtml(status),
    keyboard: buildBackToMenuKeyboard(),
  });
  return false;
}

async function handleSettingsCallback({ ctx, chatId, messageId }) {
  await renderSettingsScreen(ctx, { chatId, messageId });
  return false;
}

async function handleIntervalCallback({
  ctx,
  chatId,
  messageId,
  data,
  callback,
}) {
  const intervalMin = CB_INTERVAL_VALUES[data];
  await handleSetInterval(ctx, {
    chatId,
    messageId,
    intervalMin,
  });
  await answerBestEffort(ctx, callback, {
    text: `Интервал: ${humanIntervalLabel(intervalMin)}`,
  });
  return false;
}

async function handleToggleSummaryCallback({
  ctx,
  chatId,
  messageId,
  callback,
}) {
  const existing = await loadBotSettings();
  const previous = existing?.scheduledSummaryVisible ?? false;
  const next = !previous;
  try {
    await saveBotSettings({ scheduledSummaryVisible: next });
    logger.info("Toggled scheduled-summary visibility", { value: next });
  } catch (err) {
    logger.warn("Failed to persist scheduled-summary toggle", {
      error: String(err?.message || err),
    });
    return false;
  }
  const intervalMin =
    existing?.intervalMin ?? (await loadEffectiveIntervalMin());
  await renderSettingsScreen(ctx, {
    chatId,
    messageId,
    intervalMin,
    scheduledSummaryVisible: next,
  });
  await answerBestEffort(ctx, callback, {
    text: next ? "Уведомлять об автосинке: да" : "Уведомлять об автосинке: нет",
  });
  return false;
}

async function handleBackCallback({ ctx, chatId, messageId }) {
  await openMenuAtMessage(ctx, { chatId, messageId });
  return false;
}

async function handleBackFilesCallback({ ctx, chatId, messageId }) {
  await handleFilesCallback({ ctx, chatId, messageId });
  return false;
}

async function handleHelpCallback({ ctx, chatId, messageId }) {
  await safeCallbackRichScreen(ctx, {
    chatId,
    messageId,
    richMarkdown: BOT_HELP_RICH_MARKDOWN,
    fallbackHtml: BOT_HELP_HTML,
    keyboard: buildBackToMenuKeyboard(),
  });
  return false;
}

/** @type {Record<string, import("./dispatch.js").CallbackHandler>} */
const CALLBACK_HANDLERS = {
  [CB_RUN_SYNC]: handleRunSyncCallback,
  [CB_STATUS]: handleStatusCallback,
  [CB_FILES]: handleFilesCallback,
  [CB_FILES_TREE]: handleFilesTreeCallback,
  [CB_FILES_STATS]: handleFilesStatsCallback,
  [CB_SETTINGS]: handleSettingsCallback,
  [CB_SETTINGS_TOGGLE_SUMMARY]: handleToggleSummaryCallback,
  [CB_BACK]: handleBackCallback,
  [CB_BACK_FILES]: handleBackFilesCallback,
  [CB_HELP]: handleHelpCallback,
};

/**
 * @returns {Promise<boolean>} true when answerCallbackQuery was already sent
 */
export async function routeCallback(ctx, params) {
  const { data, callback } = params;

  const directHandler = CALLBACK_HANDLERS[data];
  if (directHandler) return directHandler({ ctx, ...params });

  if (data in CB_INTERVAL_VALUES) {
    return handleIntervalCallback({ ctx, ...params });
  }

  const treeRoute = await routeFilesTreeCallback(ctx, params);
  if (treeRoute !== null) return treeRoute;

  logger.info("Unknown callback_data", { data });
  await answerBestEffort(ctx, callback, {
    text: "Кнопка устарела — открой /menu",
    showAlert: true,
  });
  return true;
}

export { CB_INTERVAL_VALUES, CALLBACK_HANDLERS };
