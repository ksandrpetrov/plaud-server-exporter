/**
 * "Files → tree" Telegram flow.
 *
 * Owns the orchestration that ties the three tree-related pieces together:
 *
 *  - `vaultTree.js`        — pure tree builders + vault scan
 *  - `liveTreeReadModel.js` — synthetic sync-index built from live Plaud data
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

import { config, effectiveVaultRoot } from "../config/config.js";
import { createPlaudSessionLoader } from "../auth/loadPlaudSession.js";
import { logger } from "../logger.js";
import {
  buildBackToFilesKeyboard,
  buildFilesTreeEmptyKeyboard,
  buildFilesTreeFolderKeyboard,
  buildFilesTreeRootKeyboard,
  buildTreePickErrorKeyboard,
} from "./keyboards.js";
import {
  ERR_TREE_FILE_STILL_MISSING_HTML,
  ERR_TREE_FILE_STILL_MISSING_RICH,
  ERR_TREE_LOAD_HTML,
  ERR_TREE_LOAD_RICH,
  filesTreeFolderHtml,
  filesTreeFolderRichMarkdown,
  filesTreeRootHtml,
  filesTreeRootRichMarkdown,
  TREE_FILE_PICK_NO_CONTEXT_HTML,
  TREE_FILE_PICK_NO_CONTEXT_RICH,
  TREE_QUIET_SYNC_TOAST,
  treeFilePickOutOfRangeHtml,
} from "./messages.js";
import {
  safeCallbackRichScreen,
  safeSend,
  safeSendRich,
} from "./botMessageUtils.js";
import {
  runQuietSyncSafely,
  treeQuietSyncFailureMessages,
  treeSummaryDeliveryError,
  TREE_SUMMARY_DELIVERY_FAILED,
  TREE_SUMMARY_MISSING,
  trySendTreeSummary,
} from "./treeBrowseDelivery.js";
import {
  isReadablePath,
  loadTreeSource as loadTreeSourceOrchestrator,
  resolveSummaryPathAfterSync,
} from "./treeBrowseOrchestrator.js";
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

const liveTreeSessionLoader = createPlaudSessionLoader("liveTreeReadModel");

/**
 * @param {{
 *   sessionLoader?: () => Promise<import("../auth/plaudSessionExtractor.js").PlaudSession | null>;
 *   loadIndex?: () => Promise<Record<string, any>>;
 *   loadLive?: (args: Record<string, any>) => Promise<Record<string, any> | null>;
 * }} [deps]
 */
export async function loadTreeSource({
  sessionLoader = liveTreeSessionLoader,
  loadIndex,
  loadLive,
} = {}) {
  return loadTreeSourceOrchestrator({
    sessionLoader,
    loadIndex,
    loadLive,
  });
}

/** @param {Record<string, any>} ctx */
function loadTreeSourceForContext(ctx) {
  return ctx?.treeBrowse?.loadTreeSource
    ? ctx.treeBrowse.loadTreeSource()
    : loadTreeSource();
}

export async function showFilesTreeRoot(ctx, { chatId, messageId }) {
  await clearTreeBrowseState(chatId);
  try {
    const idx = await loadTreeSourceForContext(ctx);
    const root = buildSyncIndexTreeRoot(idx, {
      vaultRoot: effectiveVaultRoot(),
      subfolder: config.obsidianSubfolder,
    });
    const keyboard = root?.total
      ? buildFilesTreeRootKeyboard(root)
      : buildFilesTreeEmptyKeyboard();
    await safeCallbackRichScreen(ctx, {
      chatId,
      messageId,
      richMarkdown: filesTreeRootRichMarkdown(root),
      fallbackHtml: filesTreeRootHtml(root),
      keyboard,
      animate: false,
    });
  } catch (err) {
    logger.warn("showFilesTreeRoot failed", {
      error: String(err?.message || err),
    });
    await safeCallbackRichScreen(ctx, {
      chatId,
      messageId,
      richMarkdown: ERR_TREE_LOAD_RICH,
      fallbackHtml: ERR_TREE_LOAD_HTML,
      keyboard: buildBackToFilesKeyboard(),
      animate: false,
    });
  }
}

export async function showFilesTreeFolder(
  ctx,
  { chatId, messageId, folderIndex, page }
) {
  try {
    const idx = await loadTreeSourceForContext(ctx);
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
    await safeCallbackRichScreen(ctx, {
      chatId,
      messageId,
      richMarkdown: filesTreeFolderRichMarkdown(folderPage),
      fallbackHtml: filesTreeFolderHtml(folderPage),
      keyboard: buildFilesTreeFolderKeyboard(folderPage),
      animate: false,
    });
  } catch (err) {
    logger.warn("showFilesTreeFolder failed", {
      error: String(err?.message || err),
    });
    await safeCallbackRichScreen(ctx, {
      chatId,
      messageId,
      richMarkdown: ERR_TREE_LOAD_RICH,
      fallbackHtml: ERR_TREE_LOAD_HTML,
      keyboard: buildBackToFilesKeyboard(),
      animate: false,
    });
  }
}

async function sendTreePickError(ctx, chatId, { html, richMarkdown }) {
  await safeSendRich(ctx, chatId, richMarkdown, {
    fallbackHtml: html,
    replyMarkup: buildTreePickErrorKeyboard(),
    animate: false,
  });
}

/**
 * Owner picked a row number on the current tree page. If the .md already
 * exists on disk we open it in chat; otherwise we kick off a silent
 * sync, then re-resolve the record (its `summaryPath` may have been written
 * for the first time) and deliver the summary.
 */
export async function handleTreeFilePick(ctx, { chatId, pick }) {
  const state = await getTreeBrowseState(chatId);
  if (!state?.items?.length) {
    await sendTreePickError(ctx, chatId, {
      html: TREE_FILE_PICK_NO_CONTEXT_HTML,
      richMarkdown: TREE_FILE_PICK_NO_CONTEXT_RICH,
    });
    return;
  }
  const item = treeBrowseItemAtPick(state, pick);
  if (!item) {
    await sendTreePickError(ctx, chatId, {
      html: treeFilePickOutOfRangeHtml(pick, state.items.length),
      richMarkdown: treeFilePickOutOfRangeHtml(pick, state.items.length),
    });
    return;
  }

  const directPath = String(item.summaryPath || "").trim();
  const pathIsReadable = ctx?.treeBrowse?.isReadablePath || isReadablePath;
  if (directPath && (await pathIsReadable(directPath))) {
    const delivery = await trySendTreeSummary(ctx, chatId, directPath, item);
    if (delivery !== TREE_SUMMARY_MISSING) {
      if (delivery === TREE_SUMMARY_DELIVERY_FAILED) {
        await sendTreePickError(ctx, chatId, treeSummaryDeliveryError());
      }
      return;
    }
    // The file vanished between access and read — sync and resolve it again.
  }

  await safeSend(ctx, chatId, TREE_QUIET_SYNC_TOAST, { animate: false });

  const syncResult = await runQuietSyncSafely(ctx, chatId);
  if (syncResult.status !== "ok") {
    logger.info("Auto-sync from tree pick did not deliver", {
      chatId,
      stableId: item.stableId,
      status: syncResult.status,
    });
    await sendTreePickError(
      ctx,
      chatId,
      treeQuietSyncFailureMessages(syncResult.status)
    );
    return;
  }

  const resolveFreshPath =
    ctx?.treeBrowse?.resolveSummaryPathAfterSync || resolveSummaryPathAfterSync;
  const freshPath = await resolveFreshPath(item.stableId);
  if (!freshPath) {
    await sendTreePickError(ctx, chatId, {
      html: ERR_TREE_FILE_STILL_MISSING_HTML,
      richMarkdown: ERR_TREE_FILE_STILL_MISSING_RICH,
    });
    return;
  }
  const delivery = await trySendTreeSummary(ctx, chatId, freshPath, item);
  if (delivery === TREE_SUMMARY_MISSING) {
    await sendTreePickError(ctx, chatId, {
      html: ERR_TREE_FILE_STILL_MISSING_HTML,
      richMarkdown: ERR_TREE_FILE_STILL_MISSING_RICH,
    });
  } else if (delivery === TREE_SUMMARY_DELIVERY_FAILED) {
    await sendTreePickError(ctx, chatId, treeSummaryDeliveryError());
  }
}
