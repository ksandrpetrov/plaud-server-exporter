/**
 * Owner chat persistence.
 *
 * The scheduler needs a chat to which it can post scheduled-sync notifications,
 * but we don't want to hard-code one in `.env`: Telegram chat ids are not
 * convenient to look up. Instead, the very first authorized `/start` writes
 * `{ chatId, username, userId, capturedAt }` to `server/.data/owner-chat.json`
 * (atomic).
 *
 * Security: once written, the file is *pinned* to that `chatId`. A later
 * `/start` from the owner that arrives via a different `chatId` (e.g. the
 * owner accidentally adds the bot to a group, or someone hijacks the
 * username — see `auth.js`) is REJECTED rather than overwriting the file.
 * Operators who genuinely want to re-bind the bot must delete
 * `owner-chat.json` manually (documented in docs/server-deploy.md).
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
 * @typedef {{
 *   chatId: number;
 *   username: string;
 *   userId: number | null;
 *   capturedAt: string;
 * }} OwnerChatRecord
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
    const userId =
      typeof parsed.userId === "number" && Number.isInteger(parsed.userId)
        ? parsed.userId
        : null;
    return {
      chatId: parsed.chatId,
      username: parsed.username,
      userId,
      capturedAt: String(parsed.capturedAt || ""),
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    logger.warn("Failed to read owner-chat.json", { error: String(err?.message || err) });
    return null;
  }
}

/**
 * Persists the owner chat record atomically. The first write captures
 * `{ chatId, username, userId }`. Subsequent calls only refresh
 * `username` / `userId` / `capturedAt` if the incoming `chatId` matches;
 * a different `chatId` is rejected so a future `/start` in a group chat
 * (or under a hijacked username) cannot silently move scheduled syncs
 * elsewhere.
 *
 * @param {{ chatId: number; username: string; userId?: number | null }} input
 * @param {string} [path]
 * @returns {Promise<{ status: "saved" | "rejected"; record: OwnerChatRecord; existing?: OwnerChatRecord }>}
 */
export async function saveOwnerChat(input, path = config.ownerChatPath) {
  const chatId = Number(input.chatId);
  if (!Number.isInteger(chatId)) {
    throw new Error("saveOwnerChat: chatId must be an integer");
  }
  const username = String(input.username || "").toLowerCase();
  const userId =
    typeof input.userId === "number" && Number.isInteger(input.userId) && input.userId > 0
      ? input.userId
      : null;

  const existing = await loadOwnerChat(path);
  if (existing && existing.chatId !== chatId) {
    return { status: "rejected", record: existing, existing };
  }

  const record = {
    chatId,
    username,
    userId,
    capturedAt: new Date().toISOString(),
  };

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
  return { status: "saved", record };
}
