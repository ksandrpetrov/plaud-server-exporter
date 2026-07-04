import { parseFilesTreeFolderCallback } from "../callbackData.js";
import { showFilesTreeFolder, showFilesTreeRoot } from "../treeBrowse.js";

export async function handleFilesCallback({ ctx, chatId, messageId }) {
  await showFilesTreeRoot(ctx, { chatId, messageId });
  return false;
}

export async function handleFilesTreeCallback({ ctx, chatId, messageId }) {
  await showFilesTreeRoot(ctx, { chatId, messageId });
  return false;
}

/** Legacy inline button from older bot menus — open tree instead of disk stats. */
export async function handleFilesStatsCallback({ ctx, chatId, messageId }) {
  await showFilesTreeRoot(ctx, { chatId, messageId });
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
