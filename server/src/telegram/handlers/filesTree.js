import { config, effectiveVaultRoot } from "../../config/config.js";
import {
  buildBackToFilesKeyboard,
  buildFilesMenuKeyboard,
} from "../keyboards.js";
import { parseFilesTreeFolderCallback } from "../callbackData.js";
import {
  filesMenuHtml,
  filesMenuRichMarkdown,
  filesStatsHtml,
  filesStatsRichMarkdown,
} from "../messages.js";
import { safeCallbackRichScreen } from "../botMessageUtils.js";
import { showFilesTreeFolder, showFilesTreeRoot } from "../treeBrowse.js";
import { scanVaultSummary } from "../vaultTree.js";

export async function handleFilesCallback({ ctx, chatId, messageId }) {
  await safeCallbackRichScreen(ctx, {
    chatId,
    messageId,
    richMarkdown: filesMenuRichMarkdown(),
    fallbackHtml: filesMenuHtml(),
    keyboard: buildFilesMenuKeyboard(),
  });
  return false;
}

export async function handleFilesTreeCallback({ ctx, chatId, messageId }) {
  await showFilesTreeRoot(ctx, { chatId, messageId });
  return false;
}

export async function handleFilesStatsCallback({ ctx, chatId, messageId }) {
  const stats = await scanVaultSummary({
    vaultRoot: effectiveVaultRoot(),
    subfolder: config.obsidianSubfolder,
  });
  await safeCallbackRichScreen(ctx, {
    chatId,
    messageId,
    richMarkdown: filesStatsRichMarkdown(stats),
    fallbackHtml: filesStatsHtml(stats),
    keyboard: buildBackToFilesKeyboard(),
  });
  return false;
}

/**
 * @returns {Promise<boolean | null>} null when `data` is not a tree callback
 */
export async function routeFilesTreeCallback(ctx, { chatId, messageId, data }) {
  const folderHit = parseFilesTreeFolderCallback(data);
  if (!folderHit) return null;
  await showFilesTreeFolder(ctx, {
    chatId,
    messageId,
    folderIndex: folderHit.folderIndex,
    page: folderHit.page,
  });
  return false;
}
