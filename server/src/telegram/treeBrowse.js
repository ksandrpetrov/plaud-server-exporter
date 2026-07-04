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

import { access } from "node:fs/promises";
import { config, effectiveVaultRoot } from "../config/config.js";
import { logger } from "../logger.js";
import { getRecordByStableId, loadIndexForBot } from "../sync/syncIndexRead.js";
import {
  buildBackToFilesKeyboard,
  buildFilesTreeEmptyKeyboard,
  buildFilesTreeFolderKeyboard,
  buildFilesTreeRootKeyboard,
  buildTreePickErrorKeyboard,
  buildTreePickSuccessKeyboard,
} from "./keyboards.js";
import {
  ERR_TREE_AUTO_SYNC_FAILED_HTML,
  ERR_TREE_AUTO_SYNC_FAILED_RICH,
  ERR_TREE_FILE_STILL_MISSING_HTML,
  ERR_TREE_FILE_STILL_MISSING_RICH,
  ERR_TREE_LOAD_HTML,
  ERR_TREE_LOAD_RICH,
  ERR_TREE_SEND_DOCUMENT_HTML,
  ERR_TREE_SEND_DOCUMENT_RICH,
  filesTreeFolderHtml,
  filesTreeFolderRichMarkdown,
  filesTreeRootHtml,
  filesTreeRootRichMarkdown,
  stripLeadingDateFromTreeTitle,
  syncProgressHtml,
  syncProgressRichMarkdown,
  TREE_FILE_PICK_NO_CONTEXT_HTML,
  TREE_FILE_PICK_NO_CONTEXT_RICH,
  TREE_QUIET_SYNC_TOAST,
  treeDocumentSentHtml,
  treeDocumentSentRich,
  treeFilePickOutOfRangeHtml,
} from "./messages.js";
import {
  createSyncProgressDelivery,
  dismissDraftBubbleBestEffort,
  tryOpenDraft,
  tryOpenRichDraft,
} from "./streamingDelivery.js";
import {
  safeCallbackRichScreen,
  safeSend,
  safeSendRich,
} from "./botMessageUtils.js";
import { EFFECT_SPARKLES, privateMessageEffect } from "./telegramVisual.js";
import { loadPlaudLiveSyncTree } from "../plaud/liveTreeReadModel.js";
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

/** @type {{ loadIndex?: () => Promise<object>, loadLive?: (args: object) => Promise<object|null> } | null} */
let _testHooks = null;

/** @param {{ loadIndex?: () => Promise<object>, loadLive?: (args: object) => Promise<object|null> } | null} hooks */
export function _setTreeBrowseHooksForTests(hooks) {
  _testHooks = hooks;
}

export function _resetTreeBrowseHooksForTests() {
  _testHooks = null;
}

/**
 * Returns a sync-index-shaped object to feed the tree builders. Prefers a
 * live Plaud snapshot (so folder counts match Plaud's sidebar verbatim) and
 * falls back to the on-disk sync-index when Plaud is unreachable or no
 * session is stored. Live records carry the real `folderSegment` from the
 * filetag list, so legacy data with empty `folderSegment` still buckets
 * correctly.
 */
export async function loadTreeSource() {
  const real = _testHooks?.loadIndex
    ? await _testHooks.loadIndex()
    : await loadIndexForBot();
  try {
    const loadLive =
      _testHooks?.loadLive || ((args) => loadPlaudLiveSyncTree(args));
    const live = await loadLive({ syncIndex: real });
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
  try {
    const idx = await loadTreeSource();
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
 * exists on disk we send it straight away; otherwise we kick off a silent
 * sync, then re-resolve the record (its `summaryPath` may have been written
 * for the first time) and deliver the file.
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
  if (directPath && (await isReadable(directPath))) {
    if (await trySendDocument(ctx, chatId, directPath, item)) return;
    // The file vanished or Telegram refused — fall through to the sync-then-retry path.
  }

  await safeSend(ctx, chatId, TREE_QUIET_SYNC_TOAST, { animate: false });

  const syncResult = await runQuietSyncSafely(ctx, chatId);
  if (syncResult.status !== "ok") {
    logger.info("Auto-sync from tree pick did not deliver", {
      chatId,
      stableId: item.stableId,
      status: syncResult.status,
    });
    await sendTreePickError(ctx, chatId, {
      html: ERR_TREE_AUTO_SYNC_FAILED_HTML,
      richMarkdown: ERR_TREE_AUTO_SYNC_FAILED_RICH,
    });
    return;
  }

  const freshPath = await resolveSummaryPathAfterSync(item.stableId);
  if (!freshPath) {
    await sendTreePickError(ctx, chatId, {
      html: ERR_TREE_FILE_STILL_MISSING_HTML,
      richMarkdown: ERR_TREE_FILE_STILL_MISSING_RICH,
    });
    return;
  }
  if (!(await trySendDocument(ctx, chatId, freshPath, item))) {
    await sendTreePickError(ctx, chatId, {
      html: ERR_TREE_SEND_DOCUMENT_HTML,
      richMarkdown: ERR_TREE_SEND_DOCUMENT_RICH,
    });
  }
}

async function buildDocumentCaption(item) {
  const title = stripLeadingDateFromTreeTitle(
    item?.date,
    String(item?.title || "Запись")
  );
  const parts = [title];
  if (item?.date) parts.push(String(item.date));
  if (item?.folder) parts.push(String(item.folder));
  return parts.join(" · ");
}

function documentTitle(item) {
  return stripLeadingDateFromTreeTitle(
    item?.date,
    String(item?.title || "Запись")
  );
}

async function isReadable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function trySendDocument(ctx, chatId, documentPath, item) {
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

async function runQuietSyncSafely(ctx, chatId) {
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
  let draftActivated = false;

  const pushQuietSyncProgress = async (stats) => {
    const payload = {
      html: syncProgressHtml(stats),
      richMarkdown: syncProgressRichMarkdown(stats),
    };
    if (!draftActivated) {
      draftActivated = true;
      const richOpened = await tryOpenRichDraft({
        telegram: ctx.telegram,
        chatId,
        draftId: delivery.draftId,
        initialMarkdown: payload.richMarkdown,
      });
      if (richOpened) {
        delivery.markRichDraftActive();
        return;
      }
      const textOpened = await tryOpenDraft({
        telegram: ctx.telegram,
        chatId,
        draftId: delivery.draftId,
        initialText: payload.html,
      });
      if (textOpened) {
        delivery.markDraftActive();
        return;
      }
    }
    await delivery.pushProgress(payload);
  };

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

async function resolveSummaryPathAfterSync(stableId) {
  const id = String(stableId || "").trim();
  if (!id) return null;
  const idx = _testHooks?.loadIndex
    ? await _testHooks.loadIndex()
    : await loadIndexForBot();
  const record = getRecordByStableId(idx, id);
  const path = String(record?.summaryPath || "").trim();
  if (!path) return null;
  if (!(await isReadable(path))) return null;
  return path;
}
