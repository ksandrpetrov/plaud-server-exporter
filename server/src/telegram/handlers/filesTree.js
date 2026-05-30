import { config, effectiveVaultRoot } from "../../config/config.js";
import { buildBackToMenuKeyboard, buildFilesMenuKeyboard } from "../keyboards.js";
import { parseFilesTreeFolderCallback } from "../callbackData.js";
import { filesMenuHtml, filesStatsHtml } from "../messages.js";
import { editToMenuScreen } from "../botMessageUtils.js";
import { showFilesTreeFolder, showFilesTreeRoot } from "../treeBrowse.js";
import { scanVaultSummary } from "../vaultTree.js";

export async function handleFilesCallback({ ctx, chatId, messageId }) {
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: filesMenuHtml(),
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
  await editToMenuScreen(ctx, {
    chatId,
    messageId,
    text: filesStatsHtml(stats),
    keyboard: buildBackToMenuKeyboard(),
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
