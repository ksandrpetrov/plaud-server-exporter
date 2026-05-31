/**
 * Per-chat context for the sync tree folder listing: which page was last
 * shown and which files were numbered 1…N on that page. Used when the
 * owner replies with a digit to receive the matching .md file.
 *
 * Persisted to `server/.data/tree-browse.json` (mode `0o600`, atomic
 * rename) so a bot restart between "open folder" and "send digit" still
 * resolves the pick. Entries older than `TREE_BROWSE_TTL_MS` are dropped
 * lazily on read.
 *
 * Reads and writes are async because of disk I/O, but the API stays small
 * and self-contained — callers `await` set/get/clear.
 */

import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { readJsonSafe, writeJsonAtomic } from "../util/atomicJson.js";

/** @typedef {import("./vaultTree.js").TreeItem} TreeItem */

/**
 * @typedef {{
 *   folderIndex: number;
 *   page: number;
 *   items: TreeItem[];
 *   updatedAtMs: number;
 * }} StoredTreeBrowseState
 *
 * @typedef {Omit<StoredTreeBrowseState, "updatedAtMs">} TreeBrowseState
 */

const TREE_BROWSE_TTL_MS = 30 * 60 * 1000;

/** @type {Map<number, StoredTreeBrowseState>} */
const byChatId = new Map();
let loadedFromDisk = false;

function nowMs() {
  return Date.now();
}

function statePath() {
  return config.treeBrowseStatePath;
}

function normalizeState(state) {
  return {
    folderIndex: Math.floor(Number(state?.folderIndex) || 0),
    page: Math.max(1, Math.floor(Number(state?.page) || 1)),
    items: Array.isArray(state?.items) ? [...state.items] : [],
  };
}

function isFresh(stored, now = nowMs()) {
  if (!stored) return false;
  const ts = Number(stored.updatedAtMs);
  if (!Number.isFinite(ts)) return false;
  return now - ts < TREE_BROWSE_TTL_MS;
}

async function ensureLoaded() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  const parsed = await readJsonSafe(statePath(), { label: "tree-browse.json" });
  const records = parsed?.byChatId;
  if (records && typeof records === "object") {
    const now = nowMs();
    for (const [key, value] of Object.entries(records)) {
      const chatId = Number(key);
      if (!Number.isInteger(chatId)) continue;
      if (!isFresh(value, now)) continue;
      byChatId.set(chatId, {
        ...normalizeState(value),
        updatedAtMs: Number(value.updatedAtMs) || now,
      });
    }
  }
}

async function persist() {
  const path = statePath();
  const entries = {};
  for (const [chatId, stored] of byChatId.entries()) {
    entries[chatId] = stored;
  }
  try {
    await writeJsonAtomic(path, { byChatId: entries });
  } catch (err) {
    logger.warn("Failed to persist tree-browse.json", {
      error: String(err?.message || err),
    });
  }
}

/**
 * @param {number} chatId
 * @param {TreeBrowseState} state
 */
export async function setTreeBrowseState(chatId, state) {
  const id = Number(chatId);
  if (!Number.isInteger(id)) return;
  await ensureLoaded();
  byChatId.set(id, {
    ...normalizeState(state),
    updatedAtMs: nowMs(),
  });
  await persist();
}

/**
 * @param {number} chatId
 */
export async function clearTreeBrowseState(chatId) {
  const id = Number(chatId);
  if (!Number.isInteger(id)) return;
  await ensureLoaded();
  if (byChatId.delete(id)) await persist();
}

/**
 * @param {number} chatId
 * @returns {Promise<TreeBrowseState | null>}
 */
export async function getTreeBrowseState(chatId) {
  const id = Number(chatId);
  if (!Number.isInteger(id)) return null;
  await ensureLoaded();
  const stored = byChatId.get(id);
  if (!stored) return null;
  if (!isFresh(stored)) {
    byChatId.delete(id);
    void persist();
    return null;
  }
  return {
    folderIndex: stored.folderIndex,
    page: stored.page,
    items: [...stored.items],
  };
}

/**
 * @param {TreeBrowseState | null | undefined} state
 * @param {number} pick 1-based index on the current page
 * @returns {TreeItem | null}
 */
export function treeBrowseItemAtPick(state, pick) {
  const n = Math.floor(Number(pick) || 0);
  if (n < 1) return null;
  const items = state?.items || [];
  return items[n - 1] || null;
}

/** Clears all in-memory state and forgets the load flag (tests only). */
export function _resetTreeBrowseStateForTests() {
  byChatId.clear();
  loadedFromDisk = false;
}
