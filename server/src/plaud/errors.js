/**
 * Plaud API domain errors. Kept in a leaf module so that error
 * classification and consumers (CLI, Telegram orchestrator, sync runner)
 * do not depend on the HTTP client module.
 */

export class PlaudAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PlaudAuthError";
    this.status = status;
  }
}

export class PlaudChangedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PlaudChangedError";
    this.details = details;
  }
}
