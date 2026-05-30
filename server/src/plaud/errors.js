/**
 * Plaud API domain errors. Kept in a leaf module so that error
 * classification and consumers (CLI, Telegram orchestrator, sync runner)
 * do not depend on the HTTP client module.
 */

export class PlaudAuthError extends Error {
  /**
   * @param {string} message
   * @param {number | undefined} [status] HTTP status code from Plaud (401/403).
   */
  constructor(message, status) {
    super(message);
    this.name = "PlaudAuthError";
    /** @type {number | undefined} */
    this.status = status;
  }
}

export class PlaudChangedError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "PlaudChangedError";
    /** @type {object} */
    this.details = details;
    /**
     * Set by `syncRunner` so that callers (CLI, Telegram) can branch on the
     * canonical exit code without re-classifying the error.
     * @type {number | undefined}
     */
    this.exitCode = undefined;
    /**
     * Optional sync run stats attached by `syncRunner` when the Plaud API
     * shape changed mid-run so that error reporting can include context.
     * @type {object | undefined}
     */
    this.stats = undefined;
  }
}
