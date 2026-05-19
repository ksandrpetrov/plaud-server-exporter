/**
 * Long-polling bot loop + graceful shutdown.
 *
 * One Node process owns:
 *
 * - The Telegram long-polling loop (`getUpdates`).
 * - The scheduler that triggers periodic syncs.
 *
 * Updates are dispatched sequentially. We are a single-user bot, so we don't
 * need a worker pool, and serial dispatch keeps state simple — there is no
 * chance of two concurrent "run sync" presses arriving at `runSync` and
 * fighting over the same file lock from inside the same process.
 *
 * Duplicate callback_query suppression mirrors satellite's
 * `digest_state.claim_callback`: Telegram occasionally redelivers the same
 * callback (offset desync, double tap) and we don't want to render the
 * settings screen twice.
 */

import { logger } from "../logger.js";
import { redactError } from "../security/redact.js";
import { TelegramError } from "./telegramClient.js";
import { loadOffset, saveOffset } from "./offsetStore.js";
import { dispatchUpdate } from "./handlers.js";

const ERROR_BACKOFF_INITIAL_MS = 1_000;
const ERROR_BACKOFF_MAX_MS = 30_000;
const ERROR_BACKOFF_MULTIPLIER = 2;
const CALLBACK_DEDUP_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   allowedUsername: string;
 *   allowedUserId: number | null;
 *   longPollSec: number;
 *   runManualSync: (params: { chatId: number; loadingMessageId: number | null }) => Promise<unknown>;
 *   scheduler?: { start: () => void; stop: () => void };
 *   offsetLoader?: typeof loadOffset;
 *   offsetSaver?: typeof saveOffset;
 *   sleep?: (ms: number) => Promise<void>;
 *   nowMs?: () => number;
 * }} BotLoopDeps
 */

export class TelegramBotLoop {
  /**
   * @param {BotLoopDeps} deps
   */
  constructor(deps) {
    this._deps = deps;
    this._sleep =
      deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this._now = deps.nowMs || (() => Date.now());
    this._loadOffset = deps.offsetLoader || loadOffset;
    this._saveOffset = deps.offsetSaver || saveOffset;
    this._stopped = false;
    this._offset = 0;
    this._seenCallbackIds = new Map(); // id -> expiresAtMs
  }

  async run() {
    this._offset = await this._loadOffset();
    this._deps.scheduler?.start();
    logger.info("Telegram bot started", {
      longPollSec: this._deps.longPollSec,
      allowedUsername: this._deps.allowedUsername || "(unset)",
      allowedUserId: this._deps.allowedUserId ?? null,
    });

    let backoffMs = ERROR_BACKOFF_INITIAL_MS;
    while (!this._stopped) {
      const updates = await this._pollOrBackoff(backoffMs);
      if (updates === null) {
        backoffMs = Math.min(
          backoffMs * ERROR_BACKOFF_MULTIPLIER,
          ERROR_BACKOFF_MAX_MS
        );
        continue;
      }
      backoffMs = ERROR_BACKOFF_INITIAL_MS;
      await this._handleUpdates(updates);
    }
  }

  async shutdown() {
    if (this._stopped) return;
    this._stopped = true;
    logger.info("Telegram bot stopping");
    try {
      this._deps.scheduler?.stop();
    } catch (err) {
      logger.warn("Scheduler stop failed", {
        error: String(err?.message || err),
      });
    }
    try {
      await this._saveOffset(this._offset);
    } catch (err) {
      logger.warn("Failed to persist offset on shutdown", {
        error: String(err?.message || err),
      });
    }
    try {
      this._deps.telegram.close();
    } catch (err) {
      logger.warn("Telegram close failed", {
        error: String(err?.message || err),
      });
    }
  }

  async _pollOrBackoff(backoffMs) {
    try {
      const updates = await this._deps.telegram.getUpdates({
        offset: this._offset,
        timeoutSec: this._deps.longPollSec,
      });
      return updates;
    } catch (err) {
      if (err instanceof TelegramError) {
        logger.warn("getUpdates failed", { error: err.message });
      } else {
        logger.error("Unexpected error in getUpdates", redactError(err));
      }
      await this._sleep(backoffMs);
      return null;
    }
  }

  async _handleUpdates(updates) {
    for (const update of updates) {
      if (this._stopped) break;
      const updateId = Number(update?.update_id);
      if (!Number.isInteger(updateId)) continue;

      if (this._isDuplicateCallback(update)) {
        await this._advanceOffset(updateId);
        continue;
      }

      try {
        await dispatchUpdate(this._handlerContext(), update);
      } catch (err) {
        logger.error("Update handler crashed", redactError(err));
      } finally {
        await this._advanceOffset(updateId);
      }
    }
  }

  _isDuplicateCallback(update) {
    const callback = update?.callback_query;
    if (!callback) return false;
    const id = String(callback.id || "");
    if (!id) return false;
    this._gcDedup();
    const now = this._now();
    const existing = this._seenCallbackIds.get(id);
    if (existing && existing > now) {
      logger.info("Drop duplicate callback_query", { callbackId: id });
      return true;
    }
    this._seenCallbackIds.set(id, now + CALLBACK_DEDUP_TTL_MS);
    return false;
  }

  _gcDedup() {
    const now = this._now();
    for (const [id, expiresAt] of this._seenCallbackIds) {
      if (expiresAt <= now) this._seenCallbackIds.delete(id);
    }
  }

  _handlerContext() {
    return {
      telegram: this._deps.telegram,
      allowedUsername: this._deps.allowedUsername,
      allowedUserId: this._deps.allowedUserId ?? null,
      runManualSync: this._deps.runManualSync,
    };
  }

  async _advanceOffset(updateId) {
    if (updateId >= this._offset) {
      this._offset = updateId + 1;
      try {
        await this._saveOffset(this._offset);
      } catch (err) {
        logger.warn("Failed to persist Telegram offset", {
          error: String(err?.message || err),
        });
      }
    }
  }
}
