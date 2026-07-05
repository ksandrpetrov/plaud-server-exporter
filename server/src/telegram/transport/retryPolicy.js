import { TelegramError } from "./telegramErrors.js";
import { RETRYABLE_STATUS } from "./constants.js";

/**
 * @param {Record<string, unknown> | null | undefined} data
 * @returns {Record<string, string>}
 */
export function stringifyTelegramForm(data) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!data) return out;
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    if (typeof value === "object") {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * @param {number} attempt
 * @param {number} backoffBaseMs
 * @param {number} backoffCapMs
 * @returns {number}
 */
export function computeTelegramBackoffMs(attempt, backoffBaseMs, backoffCapMs) {
  const delay = Math.min(
    backoffBaseMs * Math.pow(2, attempt - 1),
    backoffCapMs
  );
  return delay + Math.random() * 500;
}

/**
 * @param {Response} response
 * @param {number} backoffBaseMs
 * @param {number} backoffCapMs
 * @returns {Promise<number>}
 */
export async function waitAfterTelegram429Ms(
  response,
  backoffBaseMs,
  backoffCapMs
) {
  let retryAfterSec = 0;
  try {
    const text = await response.clone().text();
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const ra = Number(parsed?.parameters?.retry_after);
      if (Number.isFinite(ra) && ra > 0) retryAfterSec = ra;
    }
  } catch {
    retryAfterSec = 0;
  }
  if (retryAfterSec <= 0) {
    const header = response.headers?.get?.("Retry-After");
    if (header) {
      const ra = Number(header);
      if (Number.isFinite(ra) && ra > 0) retryAfterSec = ra;
    }
  }
  if (retryAfterSec <= 0) {
    retryAfterSec = backoffBaseMs / 1000;
  }
  const jitter = Math.random() * 500;
  return Math.min(retryAfterSec * 1000 + jitter, backoffCapMs);
}

/**
 * @param {Response} response
 * @param {string} methodName
 * @param {(text: string) => string} sanitize
 * @param {number} backoffBaseMs
 * @param {number} backoffCapMs
 */
export async function parseTelegramResponse(
  response,
  methodName,
  sanitize,
  backoffBaseMs,
  backoffCapMs
) {
  const status = response.status;
  if (status === 200) {
    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new TelegramError(
        `${methodName}: invalid JSON response: ${sanitize(String(err?.message || err))}`
      );
    }
    if (!payload || payload.ok !== true) {
      throw new TelegramError(
        `${methodName} failed: ${sanitize(JSON.stringify(payload))}`
      );
    }
    return { kind: "ok", result: payload.result };
  }
  if (status === 429) {
    const waitMs = await waitAfterTelegram429Ms(
      response,
      backoffBaseMs,
      backoffCapMs
    );
    return { kind: "rate_limited", waitMs };
  }
  if (RETRYABLE_STATUS.has(status)) {
    try {
      await response.text();
    } catch {
      // best-effort
    }
    return { kind: "retryable", status };
  }
  let bodySnippet;
  try {
    bodySnippet = (await response.text()).slice(0, 500);
  } catch {
    bodySnippet = "";
  }
  return { kind: "fatal", status, bodySnippet };
}

/**
 * @param {{
 *   methodName: string;
 *   baseUrl: string;
 *   fetchImpl: typeof fetch;
 *   sanitize: (text: string) => string;
 *   sleep: (ms: number) => Promise<void>;
 *   backoffBaseMs: number;
 *   backoffCapMs: number;
 *   requestTimeoutMs: number;
 *   maxRetries: number;
 *   buildInit: () => { method?: string; headers?: Record<string, string>; body: unknown };
 *   agent: import("node:https").Agent;
 *   timeoutMs?: number;
 *   maxRetriesOverride?: number;
 * }} params
 */
export async function executeTelegramRetryFetch(params) {
  const {
    methodName,
    baseUrl,
    fetchImpl,
    sanitize,
    sleep,
    backoffBaseMs,
    backoffCapMs,
    maxRetries,
    buildInit,
    agent,
  } = params;
  const url = `${baseUrl}/${methodName}`;
  const effectiveTimeout = params.timeoutMs || params.requestTimeoutMs;
  const effectiveMaxRetries = Math.max(
    0,
    params.maxRetriesOverride ?? maxRetries
  );

  let attempt = 0;
  while (true) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    let response;
    try {
      response = await fetchImpl(
        url,
        /** @type {any} */ ({
          ...buildInit(),
          signal: controller.signal,
          agent,
        })
      );
    } catch (err) {
      clearTimeout(timer);
      const safeError = sanitize(String(err?.message || err));
      if (attempt > effectiveMaxRetries) {
        throw new TelegramError(
          `${methodName}: network error after ${effectiveMaxRetries} retries: ${safeError}`
        );
      }
      await sleep(
        computeTelegramBackoffMs(attempt, backoffBaseMs, backoffCapMs)
      );
      continue;
    } finally {
      clearTimeout(timer);
    }

    const parsed = await parseTelegramResponse(
      response,
      methodName,
      sanitize,
      backoffBaseMs,
      backoffCapMs
    );
    if (parsed.kind === "ok") return parsed.result;
    if (parsed.kind === "rate_limited") {
      if (attempt > effectiveMaxRetries) {
        throw new TelegramError(
          `${methodName}: still rate-limited after ${effectiveMaxRetries} retries`
        );
      }
      await sleep(parsed.waitMs);
      continue;
    }
    if (parsed.kind === "retryable") {
      if (attempt > effectiveMaxRetries) {
        throw new TelegramError(
          `${methodName}: HTTP ${parsed.status} after ${effectiveMaxRetries} retries`
        );
      }
      await sleep(
        computeTelegramBackoffMs(attempt, backoffBaseMs, backoffCapMs)
      );
      continue;
    }
    throw new TelegramError(
      `${methodName}: HTTP ${parsed.status}: ${sanitize(parsed.bodySnippet)}`
    );
  }
}
