import { logger } from "../../logger.js";
import {
  buildBackToMenuKeyboard,
  buildMainMenuKeyboard,
  buildSettingsKeyboard,
} from "../keyboards.js";
import {
  BOT_WELCOME_HTML,
  BOT_WELCOME_RICH_MARKDOWN,
  buildMainMenuRichMarkdown,
  lastSyncSummaryLine,
  MENU_HEADER,
  settingsScreenHtml,
  settingsScreenRichMarkdown,
  statusScreenHtml,
  statusScreenRichMarkdown,
} from "../messages.js";
import {
  isAllowedInterval,
  loadEffectiveIntervalMin,
  loadEffectiveScheduledSummaryVisible,
  saveBotSettings,
} from "../botSettings.js";
import {
  editToMenuScreen,
  safeCallbackRichScreen,
  safeSendRich,
} from "../botMessageUtils.js";
import { saveOwnerChat } from "../ownerChat.js";
import { readStatus } from "../../sync/statusReader.js";
import { userIdFromPayload, usernameFromPayload } from "../auth.js";

export async function handleStart(ctx, { chatId, from }) {
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
  await safeSendRich(ctx, chatId, BOT_WELCOME_RICH_MARKDOWN, {
    fallbackHtml: BOT_WELCOME_HTML,
    replyMarkup: buildMainMenuKeyboard(),
  });
}

export function buildMainMenuText(status) {
  return `${MENU_HEADER}\n\n${lastSyncSummaryLine(status)}\n\nВыбери действие:`;
}

export async function openMenu(ctx, chatId) {
  const status = await readStatus();
  await safeSendRich(ctx, chatId, buildMainMenuRichMarkdown(status), {
    fallbackHtml: buildMainMenuText(status),
    replyMarkup: buildMainMenuKeyboard(),
  });
}

export async function openMenuAtMessage(ctx, { chatId, messageId }) {
  const status = await readStatus();
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: buildMainMenuText(status),
    keyboard: buildMainMenuKeyboard(),
  });
}

export async function sendStatusMessage(ctx, chatId) {
  const status = await readStatus();
  await safeSendRich(ctx, chatId, statusScreenRichMarkdown(status), {
    fallbackHtml: statusScreenHtml(status),
    replyMarkup: buildBackToMenuKeyboard(),
  });
}

/**
 * @param {any} ctx
 * @param {{ chatId: number; messageId: number; intervalMin?: number; scheduledSummaryVisible?: boolean }} params
 */
export async function renderSettingsScreen(
  ctx,
  { chatId, messageId, intervalMin, scheduledSummaryVisible }
) {
  const resolvedInterval = intervalMin ?? (await loadEffectiveIntervalMin());
  const resolvedVisible =
    scheduledSummaryVisible ?? (await loadEffectiveScheduledSummaryVisible());
  const status = await readStatus();
  await safeCallbackRichScreen(ctx, {
    chatId,
    messageId,
    richMarkdown: settingsScreenRichMarkdown({
      intervalMin: resolvedInterval,
      lastSyncAt: status?.lastSyncAt || null,
      scheduledSummaryVisible: resolvedVisible,
    }),
    fallbackHtml: settingsScreenHtml({
      intervalMin: resolvedInterval,
      lastSyncAt: status?.lastSyncAt || null,
      scheduledSummaryVisible: resolvedVisible,
    }),
    keyboard: buildSettingsKeyboard(resolvedInterval, resolvedVisible),
  });
}

export async function handleSetInterval(
  ctx,
  { chatId, messageId, intervalMin }
) {
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
  const scheduledSummaryVisible = await loadEffectiveScheduledSummaryVisible();
  await renderSettingsScreen(ctx, {
    chatId,
    messageId,
    intervalMin,
    scheduledSummaryVisible,
  });
}
