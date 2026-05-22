/**
 * Per-chat dedup for long-running user actions (mirrors satellite ActionGuard).
 *
 * Prevents duplicate sync taps and enforces a short cooldown after a successful
 * run. Uses monotonic time so clock skew does not extend or shrink windows.
 */

/**
 * @param {number} chatId
 * @param {string} actionKey
 */
function guardKey(chatId, actionKey) {
  return `${chatId}:${actionKey}`;
}

export class ActionGuard {
  /**
   * @param {{ cooldownSec?: number }} [options]
   */
  constructor(options = {}) {
    this._cooldownSec = Math.max(0, Number(options.cooldownSec ?? 35));
    /** @type {Set<string>} */
    this._running = new Set();
    /** @type {Map<string, number>} */
    this._lastSuccessAt = new Map();
  }

  /**
   * @param {number} chatId
   * @param {string} actionKey
   * @returns {boolean}
   */
  tryAcquire(chatId, actionKey) {
    if (!Number.isInteger(chatId) || !actionKey) return true;
    const key = guardKey(chatId, actionKey);
    const now = performance.now() / 1000;
    if (this._running.has(key)) return false;
    const last = this._lastSuccessAt.get(key);
    if (last != null && now - last < this._cooldownSec) return false;
    this._running.add(key);
    return true;
  }

  /**
   * @param {number} chatId
   * @param {string} actionKey
   * @param {{ sent?: boolean }} [options]
   */
  release(chatId, actionKey, options = {}) {
    if (!Number.isInteger(chatId) || !actionKey) return;
    const key = guardKey(chatId, actionKey);
    this._running.delete(key);
    if (options.sent) {
      this._lastSuccessAt.set(key, performance.now() / 1000);
    } else {
      this._lastSuccessAt.delete(key);
    }
  }

  reset() {
    this._running.clear();
    this._lastSuccessAt.clear();
  }
}
