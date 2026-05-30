import { PlaudAuthError, PlaudChangedError } from "../plaud/errors.js";

export const ERROR_KIND_AUTH = "auth_error";
export const ERROR_KIND_PLAUD_CHANGED = "plaud_changed";
export const ERROR_KIND_NETWORK = "network_error";
export const ERROR_KIND_RATE_LIMIT = "rate_limit";
export const ERROR_KIND_WRITE = "write_error";
export const ERROR_KIND_CONFIG = "config_error";
export const ERROR_KIND_UNKNOWN = "unknown_error";

/**
 * @param {unknown} error
 * @param {{ stage?: string }} [context]
 * @returns {{
 *   kind: string;
 *   stage: string;
 *   severity: "error";
 *   message: string;
 *   httpStatus?: number;
 *   needsManualReview: boolean;
 *   exitCode: number;
 * }}
 */
export function classifyError(error, context = {}) {
  const stage = context.stage || "sync";
  const message = String(error?.message || error || "Unknown error");

  if (error instanceof PlaudAuthError) {
    return {
      kind: ERROR_KIND_AUTH,
      stage: context.stage || "auth",
      severity: "error",
      message,
      httpStatus: error.status,
      needsManualReview: false,
      exitCode: 2,
    };
  }

  if (
    error instanceof PlaudChangedError ||
    /unexpected.*(shape|response|payload)/i.test(message)
  ) {
    return {
      kind: ERROR_KIND_PLAUD_CHANGED,
      stage,
      severity: "error",
      message,
      needsManualReview: true,
      exitCode: 3,
    };
  }

  if (/\bHTTP\s+429\b/.test(message) || /rate.?limit/i.test(message)) {
    return {
      kind: ERROR_KIND_RATE_LIMIT,
      stage,
      severity: "error",
      message,
      needsManualReview: false,
      exitCode: 1,
    };
  }

  if (
    /ENOENT|EACCES|EPERM|EROFS|write|disk|quota/i.test(message) ||
    (error && typeof error === "object" && "code" in error && /^E/.test(String(error.code)))
  ) {
    return {
      kind: ERROR_KIND_WRITE,
      stage: context.stage || "write-file",
      severity: "error",
      message,
      needsManualReview: false,
      exitCode: 1,
    };
  }

  if (
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|timeout|Plaud API timeout/i.test(
      message
    )
  ) {
    return {
      kind: ERROR_KIND_NETWORK,
      stage,
      severity: "error",
      message,
      needsManualReview: false,
      exitCode: 1,
    };
  }

  if (/config|PLAUD_|missing|not found|invalid path/i.test(message)) {
    return {
      kind: ERROR_KIND_CONFIG,
      stage: context.stage || "config",
      severity: "error",
      message,
      needsManualReview: false,
      exitCode: 2,
    };
  }

  return {
    kind: ERROR_KIND_UNKNOWN,
    stage,
    severity: "error",
    message,
    needsManualReview: false,
    exitCode: 1,
  };
}
