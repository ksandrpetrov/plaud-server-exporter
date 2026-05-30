import { logger } from "../../logger.js";
import { buildBackToMenuKeyboard, buildMainMenuKeyboard, buildSettingsKeyboard } from "../keyboards.js";
import {
  BOT_WELCOME_HTML,
  lastSyncSummaryLine,
  MENU_HEADER,
  settingsScreenHtml,
  statusScreenHtml,
} from "../messages.js";
import {
  isAllowedInterval,
  loadEffectiveScheduledSummaryVisible,
  saveBotSettings,
} from "../botSettings.js";
import { editToMenuScreen, safeSend } from "../botMessageUtils.js";
import { saveOwnerChat } from "../ownerChat.js";
import { readStatus } from "../statusReader.js";
import { usernameFromPayload, userIdFromPayload } from "../auth.js";

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
  await safeSend(ctx, chatId, BOT_WELCOME_HTML, {
    replyMarkup: buildMainMenuKeyboard(),
  });
}

export async function openMenu(ctx, chatId) {
  const status = await readStatus();
  const text = `${MENU_HEADER}\n\n${lastSyncSummaryLine(status)}\n\nВыбери действие:`;
  await safeSend(ctx, chatId, text, { replyMarkup: buildMainMenuKeyboard() });
}

export async function openMenuAtMessage(ctx, { chatId, messageId }) {
  const status = await readStatus();
  const text = `${MENU_HEADER}\n\n${lastSyncSummaryLine(status)}\n\nВыбери действие:`;
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text,
    keyboard: buildMainMenuKeyboard(),
  });
}

export async function sendStatusMessage(ctx, chatId) {
  const status = await readStatus();
  await safeSend(ctx, chatId, statusScreenHtml(status), {
    replyMarkup: buildBackToMenuKeyboard(),
  });
}

export async function handleSetInterval(ctx, { chatId, messageId, intervalMin }) {
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
  const status = await readStatus();
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: settingsScreenHtml({
      intervalMin,
      lastSyncAt: status?.lastSyncAt || null,
      scheduledSummaryVisible,
    }),
    keyboard: buildSettingsKeyboard(intervalMin, scheduledSummaryVisible),
  });
}
