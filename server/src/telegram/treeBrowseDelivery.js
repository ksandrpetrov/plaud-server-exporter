/**
 * Tree browse document delivery and quiet sync (Telegram I/O).
 */

import { logger } from "../logger.js";
import {
  ERR_TREE_AUTO_SYNC_FAILED_HTML,
  ERR_TREE_AUTO_SYNC_FAILED_RICH,
  ERR_TREE_SEND_DOCUMENT_HTML,
  ERR_TREE_SEND_DOCUMENT_RICH,
  treeAutoSyncErrorForStatus,
  treeDocumentSentHtml,
  treeDocumentSentRich,
} from "./messages.js";
import {
  createSyncProgressDelivery,
  dismissDraftBubbleBestEffort,
} from "./streamingDelivery.js";
import { createSyncProgressChannel } from "./sync/syncProgressChannel.js";
import { safeSendRich } from "./botMessageUtils.js";
import { EFFECT_SPARKLES, privateMessageEffect } from "./telegramVisual.js";
import { buildTreePickSuccessKeyboard } from "./keyboards.js";
import { stripLeadingDateFromTreeTitle } from "./messages.js";

export async function buildDocumentCaption(item) {
  const title = stripLeadingDateFromTreeTitle(
    item?.date,
    String(item?.title || "Запись")
  );
  const parts = [title];
  if (item?.date) parts.push(String(item.date));
  if (item?.folder) parts.push(String(item.folder));
  return parts.join(" · ");
}

export function documentTitle(item) {
  return stripLeadingDateFromTreeTitle(
    item?.date,
    String(item?.title || "Запись")
  );
}

/**
 * @param {{ telegram: import("./telegramClient.js").TelegramClient } & Record<string, any>} ctx
 * @param {number} chatId
 * @param {string} documentPath
 * @param {Record<string, any>} item
 */
export async function trySendTreeDocument(ctx, chatId, documentPath, item) {
  try {
    await ctx.telegram.sendDocument({
      chatId,
      documentPath,
      caption: await buildDocumentCaption(item),
      messageEffectId: privateMessageEffect(EFFECT_SPARKLES, chatId),
    });
    const title = documentTitle(item);
    await safeSendRich(ctx, chatId, treeDocumentSentRich(title), {
      fallbackHtml: treeDocumentSentHtml(title),
      replyMarkup: buildTreePickSuccessKeyboard(),
      animate: false,
    });
    return true;
  } catch (err) {
    logger.warn("sendDocument failed", {
      path: documentPath,
      error: String(err?.message || err),
    });
    return false;
  }
}

export function treeSendDocumentError() {
  return {
    html: ERR_TREE_SEND_DOCUMENT_HTML,
    richMarkdown: ERR_TREE_SEND_DOCUMENT_RICH,
  };
}

/**
 * @param {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   runSyncQuiet?: Function;
 * } & Record<string, any>} ctx
 * @param {number} chatId
 * @returns {Promise<{ status: string; stats?: object }>}
 */
export async function runQuietSyncSafely(ctx, chatId) {
  if (typeof ctx.runSyncQuiet !== "function") {
    logger.warn(
      "Auto-sync requested but runSyncQuiet is not wired into the bot"
    );
    return { status: "failed" };
  }
  const delivery = createSyncProgressDelivery({
    telegram: ctx.telegram,
    chatId,
  });
  const pushQuietSyncProgress = createSyncProgressChannel({
    mode: "immediate",
    telegram: ctx.telegram,
    chatId,
    delivery,
  });

  try {
    const result = await ctx.runSyncQuiet({
      chatId,
      onProgress: (stats) => {
        void pushQuietSyncProgress(stats);
      },
    });
    return result || { status: "failed" };
  } catch (err) {
    logger.warn("runSyncQuiet threw", {
      error: String(err?.message || err),
    });
    return { status: "failed" };
  } finally {
    if (delivery.isDraftMode()) {
      await dismissDraftBubbleBestEffort({
        telegram: ctx.telegram,
        chatId,
      });
    }
  }
}

/**
 * @param {string} status
 */
export function treeQuietSyncFailureMessages(status) {
  const mapped = treeAutoSyncErrorForStatus(status);
  if (mapped) return mapped;
  return {
    html: ERR_TREE_AUTO_SYNC_FAILED_HTML,
    richMarkdown: ERR_TREE_AUTO_SYNC_FAILED_RICH,
  };
}
