/**
 * "Files → tree" Telegram flow.
 *
 * Owns the orchestration that ties the three tree-related pieces together:
 *
 *  - `vaultTree.js`        — pure tree builders + vault scan
 *  - `plaudLiveTree.js`    — synthetic sync-index built from live Plaud data
 *  - `treeBrowseState.js`  — persistent per-chat pick context with TTL
 *
 * Exposes four entry points the dispatcher calls:
 *
 *  - `showFilesTreeRoot`   — render the folder list
 *  - `showFilesTreeFolder` — render a page inside one folder
 *  - `handleTreeFilePick`  — owner sent a digit, send back the matching .md
 *  - `loadTreeSource`      — exported for tests that want the merged source
 *
 * The handlers receive a `ctx` from `handlers.js` (telegram client + auth)
 * and route through `botMessageUtils.js`, so they never throw.
 */

import { access } from "node:fs/promises";
import { config, effectiveVaultRoot } from "../config/config.js";
import { logger } from "../logger.js";
import { loadSyncIndex } from "../sync/serverSyncIndex.js";
import {
  buildFilesTreeFolderKeyboard,
  buildFilesTreeRootKeyboard,
} from "./keyboards.js";
import {
  filesTreeFolderHtml,
  filesTreeRootHtml,
  TREE_FILE_PICK_MISSING_ON_DISK_HTML,
  TREE_FILE_PICK_NOT_SYNCED_HTML,
  TREE_FILE_PICK_NO_CONTEXT_HTML,
  treeFilePickOutOfRangeHtml,
} from "./messages.js";
import { editToMenuScreen, safeSend } from "./botMessageUtils.js";
import { loadPlaudLiveSyncTree } from "./plaudLiveTree.js";
import {
  clearTreeBrowseState,
  getTreeBrowseState,
  setTreeBrowseState,
  treeBrowseItemAtPick,
} from "./treeBrowseState.js";
import {
  buildSyncIndexFolderPage,
  buildSyncIndexTreeRoot,
} from "./vaultTree.js";

/**
 * Returns a sync-index-shaped object to feed the tree builders. Prefers a
 * live Plaud snapshot (so folder counts match Plaud's sidebar verbatim) and
 * falls back to the on-disk sync-index when Plaud is unreachable or no
 * session is stored. Live records carry the real `folderSegment` from the
 * filetag list, so legacy data with empty `folderSegment` still buckets
 * correctly.
 */
export async function loadTreeSource() {
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

export async function showFilesTreeRoot(ctx, { chatId, messageId }) {
  await clearTreeBrowseState(chatId);
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

export async function showFilesTreeFolder(ctx, { chatId, messageId, folderIndex, page }) {
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
  await setTreeBrowseState(chatId, {
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

export async function handleTreeFilePick(ctx, { chatId, pick }) {
  const state = await getTreeBrowseState(chatId);
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
