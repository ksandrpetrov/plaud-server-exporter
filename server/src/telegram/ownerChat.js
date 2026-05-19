/**
 * Owner chat persistence.
 *
 * The scheduler needs a chat to which it can post scheduled-sync notifications,
 * but we don't want to hard-code one in `.env`: Telegram chat ids are not
 * convenient to look up. Instead, the very first authorized `/start` writes
 * `{ chatId, username, capturedAt }` to `server/.data/owner-chat.json` (atomic).
 *
 * The file lives in the same data dir as `session.json` and `sync-index.json`,
 * is mode `0o600`, and is git-ignored via the existing `server/.data/` entry.
 */

import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config/config.js";
import { logger } from "../logger.js";

/**
 * @typedef {{ chatId: number; username: string; capturedAt: string }} OwnerChatRecord
 */

/**
 * @param {string} [path]
 * @returns {Promise<OwnerChatRecord | null>}
 */
export async function loadOwnerChat(path = config.ownerChatPath) {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    if (
      !parsed ||
      typeof parsed.chatId !== "number" ||
      typeof parsed.username !== "string"
    ) {
      return null;
    }
    return {
      chatId: parsed.chatId,
      username: parsed.username,
      capturedAt: String(parsed.capturedAt || ""),
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    logger.warn("Failed to read owner-chat.json", { error: String(err?.message || err) });
    return null;
  }
}

/**
 * Persists the owner chat record atomically. Overwrites any previous record.
 *
 * @param {{ chatId: number; username: string }} input
 * @param {string} [path]
 * @returns {Promise<OwnerChatRecord>}
 */
export async function saveOwnerChat(input, path = config.ownerChatPath) {
  const record = {
    chatId: Number(input.chatId),
    username: String(input.username || "").toLowerCase(),
    capturedAt: new Date().toISOString(),
  };
  if (!Number.isInteger(record.chatId)) {
    throw new Error("saveOwnerChat: chatId must be an integer");
  }
  await mkdir(dirname(path), { recursive: true });
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, payload, "utf8");
  await rename(tmp, path);
  try {
    await chmod(path, 0o600);
  } catch {
    // best-effort on Windows / restricted filesystems
  }
  return record;
}
