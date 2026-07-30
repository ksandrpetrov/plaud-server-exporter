/**
 * Tree browse summary delivery and quiet sync (Telegram I/O).
 */

import { readFile } from "node:fs/promises";
import { logger } from "../logger.js";
import {
  ERR_TREE_AUTO_SYNC_FAILED_HTML,
  ERR_TREE_AUTO_SYNC_FAILED_RICH,
  ERR_TREE_SUMMARY_DELIVERY_HTML,
  ERR_TREE_SUMMARY_DELIVERY_RICH,
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
import {
  RICH_MARKDOWN_MAX_LEN,
  splitRichMarkdown,
  stripUtf8Bom,
} from "./richFormat.js";

const RICH_PART_LABEL_RESERVE = 80;
const PLAIN_MESSAGE_MAX_LEN = 3800;
const PLAIN_PART_LABEL_RESERVE = 80;

export const TREE_SUMMARY_SENT = "sent";
export const TREE_SUMMARY_MISSING = "missing";
export const TREE_SUMMARY_DELIVERY_FAILED = "delivery_failed";

export async function buildDocumentCaption(item) {
  const title = documentTitle(item);
  const parts = [title];
  if (item?.date) parts.push(String(item.date));
  if (item?.folder) parts.push(String(item.folder));
  return parts.join(" · ");
}

export function documentTitle(item) {
  return (
    stripLeadingDateFromTreeTitle(
      item?.date,
      String(item?.title || "Запись")
    ).trim() || "Запись"
  );
}

export function buildTreeSummaryMarkdown(item, contents) {
  const metadata = [];
  if (item?.date) metadata.push(String(item.date));
  if (item?.folder) metadata.push(String(item.folder));
  const header = [`# ${documentTitle(item)}`];
  if (metadata.length) header.push(`_${metadata.join(" · ")}_`);
  const body = stripUtf8Bom(contents).trim();
  if (!body) return `${header.join("\n\n")}\n\n_Саммари пустое._`;
  return `${header.join("\n\n")}\n\n${body}`;
}

function buildPagedParts(markdown, maxLen, reserve, label) {
  const chunks = splitRichMarkdown(markdown, Math.max(1, maxLen - reserve));
  if (chunks.length <= 1) return chunks;
  return chunks.map(
    (chunk, index) => `_${label} ${index + 1}/${chunks.length}_\n\n${chunk}`
  );
}

/**
 * @param {{ telegram: import("./telegramClient.js").TelegramClient } & Record<string, any>} ctx
 * @param {number} chatId
 * @param {string} documentPath
 * @param {Record<string, any>} item
 */
async function trySendTreeDocument(ctx, chatId, documentPath, item) {
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

async function trySendPlainSummary(ctx, chatId, markdown) {
  const parts = buildPagedParts(
    markdown,
    PLAIN_MESSAGE_MAX_LEN,
    PLAIN_PART_LABEL_RESERVE,
    "Продолжение"
  );
  if (!parts.length) return false;

  for (let index = 0; index < parts.length; index++) {
    try {
      await ctx.telegram.sendMessage({
        chatId,
        text: parts[index],
        parseMode: null,
        replyMarkup:
          index === parts.length - 1 ? buildTreePickSuccessKeyboard() : null,
      });
    } catch (err) {
      logger.warn("Plain summary delivery failed", {
        part: index + 1,
        totalParts: parts.length,
        error: String(err?.message || err),
      });
      return false;
    }
  }
  return true;
}

async function trySendSummaryText(ctx, chatId, markdown) {
  const baseParts = splitRichMarkdown(
    markdown,
    RICH_MARKDOWN_MAX_LEN - RICH_PART_LABEL_RESERVE
  );
  if (!baseParts.length) return false;

  if (typeof ctx.telegram.sendRichMessage === "function") {
    for (let index = 0; index < baseParts.length; index++) {
      const richPart =
        baseParts.length === 1
          ? baseParts[index]
          : `_Часть ${index + 1}/${baseParts.length}_\n\n${baseParts[index]}`;
      try {
        await ctx.telegram.sendRichMessage({
          chatId,
          markdown: richPart,
          replyMarkup:
            index === baseParts.length - 1
              ? buildTreePickSuccessKeyboard()
              : null,
          messageEffectId:
            index === 0 ? privateMessageEffect(EFFECT_SPARKLES, chatId) : null,
        });
      } catch (err) {
        logger.info(
          "Rich summary delivery failed; falling back to plain text",
          {
            part: index + 1,
            totalParts: baseParts.length,
            error: String(err?.message || err),
          }
        );
        const remaining = baseParts.slice(index).join("\n\n");
        return trySendPlainSummary(
          ctx,
          chatId,
          index > 0
            ? `_Продолжение ${index + 1}/${baseParts.length}_\n\n${remaining}`
            : remaining
        );
      }
    }
    return true;
  }

  return trySendPlainSummary(ctx, chatId, markdown);
}

/**
 * Reads a summary and sends it into the chat. The original document is only
 * used when both rich and plain-text delivery fail.
 *
 * @returns {Promise<"sent" | "missing" | "delivery_failed">}
 */
export async function trySendTreeSummary(ctx, chatId, documentPath, item) {
  let contents;
  try {
    contents = await readFile(documentPath, "utf8");
  } catch (err) {
    logger.info("Summary file could not be read", {
      path: documentPath,
      error: String(err?.message || err),
    });
    return TREE_SUMMARY_MISSING;
  }

  const markdown = buildTreeSummaryMarkdown(item, contents);
  if (await trySendSummaryText(ctx, chatId, markdown)) {
    return TREE_SUMMARY_SENT;
  }
  if (await trySendTreeDocument(ctx, chatId, documentPath, item)) {
    return TREE_SUMMARY_SENT;
  }
  return TREE_SUMMARY_DELIVERY_FAILED;
}

export function treeSummaryDeliveryError() {
  return {
    html: ERR_TREE_SUMMARY_DELIVERY_HTML,
    richMarkdown: ERR_TREE_SUMMARY_DELIVERY_RICH,
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
