/**
 * Thin Telegram Bot API client over `fetch` (Node 20+ has it natively).
 *
 * Design mirrors satellite's `satellite/telegram_bot/api.py`:
 *
 * - One client owns two logical channels backed by separate HTTPS keep-alive
 *   agents — long-poll (`getUpdates`) cannot share a connection pool with
 *   outgoing requests, otherwise `sendMessage`/`editMessageText` calls can
 *   queue up behind a 30 s long-poll and inflate p99 latency.
 * - Retries on 429 (respecting `parameters.retry_after`) and 5xx with jittered
 *   exponential backoff. Network errors are also retried.
 * - The token never appears in thrown errors or rejection messages: it is
 *   scrubbed from both the raw token text and any embedded `api.telegram.org`
 *   URL before the error reaches a logger.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Agent } from "node:https";
import {
  isHtmlEntitiesRejected,
  stripUnsupportedHtml,
} from "./htmlFormat.js";
import { isMessageEffectRejected } from "./telegramVisual.js";

const TELEGRAM_API = "https://api.telegram.org";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const SEND_MESSAGE_TIMEOUT_MS = 8000;
const SEND_MESSAGE_MAX_RETRIES = 1;
const EDIT_MESSAGE_TIMEOUT_MS = 3000;
const EDIT_MESSAGE_MAX_RETRIES = 0;
const LONG_POLL_METHOD = "getUpdates";

export class TelegramError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelegramError";
  }
}

export class TelegramClient {
  /**
   * @param {string} botToken
   * @param {{
   *   maxRetries?: number;
   *   backoffBaseMs?: number;
   *   backoffCapMs?: number;
   *   requestTimeoutMs?: number;
   *   fetchImpl?: typeof fetch;
   *   nowMs?: () => number;
   *   sleep?: (ms: number) => Promise<void>;
   * }} [options]
   */
  constructor(botToken, options = {}) {
    if (!botToken || typeof botToken !== "string") {
      throw new TelegramError("TelegramClient requires a non-empty bot token");
    }
    this._token = botToken;
    this._baseUrl = `${TELEGRAM_API}/bot${botToken}`;
    this._maxRetries = options.maxRetries ?? 4;
    this._backoffBaseMs = options.backoffBaseMs ?? 1500;
    this._backoffCapMs = options.backoffCapMs ?? 30000;
    this._requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this._fetch = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this._now = options.nowMs || (() => Date.now());
    this._sleep =
      options.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    this._defaultAgent = new Agent({
      keepAlive: true,
      maxSockets: 16,
      keepAliveMsecs: 30000,
    });
    this._longPollAgent = new Agent({
      keepAlive: true,
      maxSockets: 2,
      keepAliveMsecs: 60000,
    });
  }

  /** Closes underlying keep-alive sockets. Safe to call multiple times. */
  close() {
    try {
      this._defaultAgent.destroy();
    } catch {
      // best-effort
    }
    try {
      this._longPollAgent.destroy();
    } catch {
      // best-effort
    }
  }

  /**
   * Replace the bot token and any embedded `api.telegram.org/bot<token>` URL
   * with stable placeholders. Used in both error messages and JSON dumps.
   *
   * @param {string} text
   * @returns {string}
   */
  sanitize(text) {
    if (!text) return text;
    let safe = String(text);
    if (this._token) {
      safe = safe.split(this._token).join("<telegram-token>");
    }
    safe = safe.split(this._baseUrl).join(`${TELEGRAM_API}/bot<telegram-token>`);
    return safe;
  }

  // --- public API --------------------------------------------------------

  /**
   * @param {{
   *   chatId: number | string;
   *   text: string;
   *   parseMode?: string | null;
   *   replyMarkup?: object | null;
   *   disableWebPagePreview?: boolean;
   * }} params
   */
  async sendMessage(params) {
    return this._sendOrEditWithFallback({
      methodName: "sendMessage",
      text: params.text,
      buildData: (text, { dropEffect = false } = {}) => {
        const data = {
          chat_id: params.chatId,
          text,
        };
        if (params.parseMode !== null) data.parse_mode = params.parseMode || "HTML";
        if (params.disableWebPagePreview !== false) {
          data.link_preview_options = JSON.stringify({ is_disabled: true });
        }
        if (params.replyMarkup != null) {
          data.reply_markup = JSON.stringify(params.replyMarkup);
        }
        if (!dropEffect && params.messageEffectId) {
          data.message_effect_id = params.messageEffectId;
        }
        return data;
      },
      timeoutMs: SEND_MESSAGE_TIMEOUT_MS,
      maxRetries: SEND_MESSAGE_MAX_RETRIES,
    });
  }

  /**
   * @param {{
   *   chatId: number | string;
   *   messageId: number;
   *   text: string;
   *   parseMode?: string | null;
   *   replyMarkup?: object | null;
   *   disableWebPagePreview?: boolean;
   * }} params
   */
  async editMessageText(params) {
    return this._sendOrEditWithFallback({
      methodName: "editMessageText",
      text: params.text,
      buildData: (text, { dropEffect = false } = {}) => {
        const data = {
          chat_id: params.chatId,
          message_id: params.messageId,
          text,
        };
        if (params.parseMode !== null) data.parse_mode = params.parseMode || "HTML";
        if (params.disableWebPagePreview !== false) {
          data.link_preview_options = JSON.stringify({ is_disabled: true });
        }
        if (params.replyMarkup != null) {
          data.reply_markup = JSON.stringify(params.replyMarkup);
        }
        if (!dropEffect && params.messageEffectId) {
          data.message_effect_id = params.messageEffectId;
        }
        return data;
      },
      timeoutMs: EDIT_MESSAGE_TIMEOUT_MS,
      maxRetries: EDIT_MESSAGE_MAX_RETRIES,
    });
  }

  /**
   * @param {{
   *   chatId: number | string;
   *   draftId: number;
   *   text: string;
   *   parseMode?: string | null;
   * }} params
   */
  async sendMessageDraft(params) {
    const data = {
      chat_id: params.chatId,
      draft_id: params.draftId,
      text: params.text,
    };
    if (params.parseMode !== null) data.parse_mode = params.parseMode || "HTML";
    return this._call("sendMessageDraft", {
      data,
      timeoutMs: EDIT_MESSAGE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  /**
   * Closes the "loading clock" on an inline button. Best-effort: Telegram
   * shows the spinner for up to 30 s if we don't answer, but if we already
   * edited the message we just want to make the indicator go away.
   *
   * @param {{ callbackQueryId: string; text?: string | null; showAlert?: boolean }} params
   */
  async answerCallbackQuery(params) {
    const data = { callback_query_id: params.callbackQueryId };
    if (params.text) data.text = params.text;
    if (params.showAlert) data.show_alert = "true";
    return this._call("answerCallbackQuery", {
      data,
      timeoutMs: EDIT_MESSAGE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  /**
   * @param {{ chatId: number | string; action?: string }} params
   */
  /**
   * Sends a file as a Telegram document (e.g. vault .md unchanged).
   *
   * @param {{
   *   chatId: number | string;
   *   documentPath: string;
   *   caption?: string | null;
   * }} params
   */
  async sendDocument(params) {
    const path = String(params.documentPath || "");
    if (!path) {
      throw new TelegramError("sendDocument: documentPath is required");
    }
    const buf = await readFile(path);
    const form = new FormData();
    form.append("chat_id", String(params.chatId));
    form.append("document", new Blob([buf]), basename(path));
    if (params.caption) form.append("caption", params.caption);
    return this._callMultipart("sendDocument", {
      form,
      timeoutMs: SEND_MESSAGE_TIMEOUT_MS,
      maxRetries: SEND_MESSAGE_MAX_RETRIES,
    });
  }

  async sendChatAction(params) {
    const data = {
      chat_id: params.chatId,
      action: params.action || "typing",
    };
    return this._call("sendChatAction", {
      data,
      timeoutMs: EDIT_MESSAGE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  /**
   * @param {Array<{ command: string; description: string }>} commands
   */
  async setMyCommands(commands) {
    return this._call("setMyCommands", {
      data: { commands: JSON.stringify(commands) },
      timeoutMs: SEND_MESSAGE_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  /**
   * @param {{ offset: number; timeoutSec: number; allowedUpdates?: string[] }} params
   * @returns {Promise<Array<object>>}
   */
  async getUpdates(params) {
    const allowed = params.allowedUpdates || ["message", "callback_query"];
    const data = {
      offset: params.offset,
      timeout: params.timeoutSec,
      allowed_updates: JSON.stringify(allowed),
    };
    const result = await this._call(LONG_POLL_METHOD, {
      data,
      timeoutMs: (params.timeoutSec + 10) * 1000,
      maxRetries: 0,
    });
    return Array.isArray(result) ? result : [];
  }

  // --- internals ---------------------------------------------------------

  async _sendOrEditWithFallback({ methodName, text, buildData, timeoutMs, maxRetries }) {
    try {
      return await this._call(methodName, {
        data: buildData(text),
        timeoutMs,
        maxRetries,
      });
    } catch (err) {
      if (!(err instanceof TelegramError)) throw err;
      if (isHtmlEntitiesRejected(err)) {
        const stripped = stripUnsupportedHtml(text);
        if (stripped !== text) {
          return this._call(methodName, {
            data: buildData(stripped),
            timeoutMs,
            maxRetries: 0,
          });
        }
      }
      if (isMessageEffectRejected(err)) {
        return this._call(methodName, {
          data: buildData(text, { dropEffect: true }),
          timeoutMs,
          maxRetries: 0,
        });
      }
      throw err;
    }
  }

  async _callMultipart(methodName, { form, timeoutMs, maxRetries }) {
    const url = `${this._baseUrl}/${methodName}`;
    const effectiveTimeout = timeoutMs || this._requestTimeoutMs;
    const effectiveMaxRetries = Math.max(0, maxRetries ?? this._maxRetries);

    let attempt = 0;
    while (true) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), effectiveTimeout);
      let response;
      try {
        response = await this._fetch(url, {
          method: "POST",
          body: form,
          signal: controller.signal,
          agent: this._defaultAgent,
        });
      } catch (err) {
        clearTimeout(timer);
        const safeError = this.sanitize(String(err?.message || err));
        if (attempt > effectiveMaxRetries) {
          throw new TelegramError(
            `${methodName}: network error after ${effectiveMaxRetries} retries: ${safeError}`
          );
        }
        const wait = this._computeBackoffMs(attempt);
        await this._sleep(wait);
        continue;
      } finally {
        clearTimeout(timer);
      }

      const parsed = await this._parseResponse(response, methodName);
      if (parsed.kind === "ok") return parsed.result;
      if (parsed.kind === "rate_limited") {
        if (attempt > effectiveMaxRetries) {
          throw new TelegramError(
            `${methodName}: still rate-limited after ${effectiveMaxRetries} retries`
          );
        }
        await this._sleep(parsed.waitMs);
        continue;
      }
      if (parsed.kind === "retryable") {
        if (attempt > effectiveMaxRetries) {
          throw new TelegramError(
            `${methodName}: HTTP ${parsed.status} after ${effectiveMaxRetries} retries`
          );
        }
        await this._sleep(this._computeBackoffMs(attempt));
        continue;
      }
      throw new TelegramError(
        `${methodName}: HTTP ${parsed.status}: ${this.sanitize(parsed.bodySnippet)}`
      );
    }
  }

  async _call(methodName, { data, timeoutMs, maxRetries }) {
    const url = `${this._baseUrl}/${methodName}`;
    const effectiveTimeout = timeoutMs || this._requestTimeoutMs;
    const effectiveMaxRetries = Math.max(0, maxRetries ?? this._maxRetries);
    const agent =
      methodName === LONG_POLL_METHOD ? this._longPollAgent : this._defaultAgent;

    let attempt = 0;
    while (true) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), effectiveTimeout);
      let response;
      try {
        response = await this._fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(stringifyForm(data)).toString(),
          signal: controller.signal,
          // Node's undici fetch reads `dispatcher`, but `agent` is still
          // honored by some test mocks; we set both so neither pool gets
          // mixed up in production or in tests using `node:http` shims.
          agent,
        });
      } catch (err) {
        clearTimeout(timer);
        const safeError = this.sanitize(String(err?.message || err));
        if (attempt > effectiveMaxRetries) {
          throw new TelegramError(
            `${methodName}: network error after ${effectiveMaxRetries} retries: ${safeError}`
          );
        }
        const wait = this._computeBackoffMs(attempt);
        await this._sleep(wait);
        continue;
      } finally {
        clearTimeout(timer);
      }

      const parsed = await this._parseResponse(response, methodName);
      if (parsed.kind === "ok") return parsed.result;
      if (parsed.kind === "rate_limited") {
        if (attempt > effectiveMaxRetries) {
          throw new TelegramError(
            `${methodName}: still rate-limited after ${effectiveMaxRetries} retries`
          );
        }
        await this._sleep(parsed.waitMs);
        continue;
      }
      if (parsed.kind === "retryable") {
        if (attempt > effectiveMaxRetries) {
          throw new TelegramError(
            `${methodName}: HTTP ${parsed.status} after ${effectiveMaxRetries} retries`
          );
        }
        await this._sleep(this._computeBackoffMs(attempt));
        continue;
      }
      throw new TelegramError(
        `${methodName}: HTTP ${parsed.status}: ${this.sanitize(parsed.bodySnippet)}`
      );
    }
  }

  async _parseResponse(response, methodName) {
    const status = response.status;
    if (status === 200) {
      let payload;
      try {
        payload = await response.json();
      } catch (err) {
        throw new TelegramError(
          `${methodName}: invalid JSON response: ${this.sanitize(String(err?.message || err))}`
        );
      }
      if (!payload || payload.ok !== true) {
        throw new TelegramError(
          `${methodName} failed: ${this.sanitize(JSON.stringify(payload))}`
        );
      }
      return { kind: "ok", result: payload.result };
    }
    if (status === 429) {
      const waitMs = await this._waitAfter429Ms(response);
      return { kind: "rate_limited", waitMs };
    }
    if (RETRYABLE_STATUS.has(status)) {
      // Drain body to free the socket; we don't need its content.
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

  async _waitAfter429Ms(response) {
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
      retryAfterSec = this._backoffBaseMs / 1000;
    }
    const jitter = Math.random() * 500;
    return Math.min(retryAfterSec * 1000 + jitter, this._backoffCapMs);
  }

  _computeBackoffMs(attempt) {
    const delay = Math.min(
      this._backoffBaseMs * Math.pow(2, attempt - 1),
      this._backoffCapMs
    );
    return delay + Math.random() * 500;
  }
}

function stringifyForm(data) {
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
