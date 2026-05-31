/**
 * Background scheduler that owns the "every N minutes" cadence the systemd
 * timer used to drive. One process, one in-memory loop, one shared file lock
 * with manual runs — no race conditions.
 *
 * Cadence:
 *
 * - Tick every 30 s (cheap; the inner check only touches `status.json`).
 * - Trigger a sync when `now - lastSyncAt >= intervalMin` and no sync is
 *   currently executing inside this process (we also have `acquireSyncLock`
 *   as a host-wide safety net).
 * - On startup we wait 60 s before the first tick: gives the bot time to
 *   announce itself and avoids hammering Plaud right after a CLI run.
 */

import { logger } from "../logger.js";
import { loadEffectiveIntervalMin } from "./botSettings.js";
import { loadOwnerChat } from "./ownerChat.js";
import { readStatus } from "../sync/statusReader.js";

const DEFAULT_TICK_MS = 30_000;
const DEFAULT_STARTUP_DELAY_MS = 60_000;

/**
 * @typedef {{
 *   telegram: import("./telegramClient.js").TelegramClient;
 *   runOrchestrator: (params: { chatId: number; source: "scheduled" }) => Promise<unknown>;
 *   nowMs?: () => number;
 *   tickMs?: number;
 *   startupDelayMs?: number;
 *   statusReader?: () => Promise<object | null>;
 *   ownerChatReader?: () => Promise<{ chatId: number } | null>;
 *   intervalLoader?: () => Promise<number>;
 *   schedule?: (cb: () => void, ms: number) => unknown;
 *   cancel?: (handle: unknown) => void;
 * }} SchedulerDeps
 */

export class BotScheduler {
  /**
   * @param {SchedulerDeps} deps
   */
  constructor(deps) {
    this._deps = deps;
    this._now = deps.nowMs || (() => Date.now());
    this._tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this._startupDelayMs = deps.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS;
    this._readStatus = deps.statusReader || readStatus;
    this._readOwnerChat = deps.ownerChatReader || loadOwnerChat;
    this._readInterval = deps.intervalLoader || loadEffectiveIntervalMin;
    this._schedule =
      deps.schedule || ((cb, ms) => setTimeout(cb, ms).unref?.());
    this._cancel =
      deps.cancel || ((handle) => clearTimeout(/** @type {any} */ (handle)));

    this._stopped = false;
    this._inFlight = false;
    this._handle = null;
    this._earliestNextRunMs = this._now() + this._startupDelayMs;
  }

  start() {
    if (this._handle != null) return;
    this._stopped = false;
    this._handle = this._schedule(() => this._tick(), this._tickMs);
  }

  stop() {
    this._stopped = true;
    if (this._handle != null) {
      try {
        this._cancel(this._handle);
      } catch {
        // best-effort
      }
      this._handle = null;
    }
  }

  /**
   * Exposed for tests: synchronously run one tick.
   */
  async runOnce() {
    if (this._stopped) return;
    if (this._inFlight) return;
    if (this._now() < this._earliestNextRunMs) return;

    const ownerChat = await this._readOwnerChat();
    if (!ownerChat) {
      // Nothing to notify; quietly skip until the user does /start.
      return;
    }

    const status = await this._readStatus();
    const intervalMin = await this._readInterval();
    const due = isSyncDue(status, intervalMin, this._now());
    if (!due) return;

    this._inFlight = true;
    try {
      await this._deps.runOrchestrator({
        chatId: ownerChat.chatId,
        source: "scheduled",
      });
    } catch (err) {
      // Orchestrator already converts errors into Telegram messages; this is
      // just a defensive guard so a bug never kills the loop.
      logger.error("Scheduler tick failed", {
        error: String(err?.message || err),
      });
    } finally {
      this._inFlight = false;
    }
  }

  async _tick() {
    try {
      await this.runOnce();
    } finally {
      if (!this._stopped) {
        this._handle = this._schedule(() => this._tick(), this._tickMs);
      }
    }
  }
}

/**
 * Pure helper for tests.
 *
 * @param {object | null} status
 * @param {number} intervalMin
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isSyncDue(status, intervalMin, nowMs) {
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return false;
  const lastSyncAt = status?.lastSyncAt;
  if (!lastSyncAt) return true;
  const last = Date.parse(lastSyncAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= intervalMin * 60_000;
}
