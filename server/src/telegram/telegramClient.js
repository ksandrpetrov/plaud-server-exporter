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
import {
  retryRichSendAfterTelegramReject,
  retrySendOrEditAfterTelegramReject,
} from "./htmlFallback.js";
import {
  EDIT_MESSAGE_MAX_RETRIES,
  EDIT_MESSAGE_TIMEOUT_MS,
  LONG_POLL_METHOD,
  SEND_MESSAGE_MAX_RETRIES,
  SEND_MESSAGE_TIMEOUT_MS,
  TELEGRAM_API,
} from "./transport/constants.js";
import { createTelegramErrorSanitizer } from "./transport/errorSanitizer.js";
import {
  createTelegramHttpAgents,
  destroyTelegramHttpAgents,
} from "./transport/httpAgents.js";
import {
  executeTelegramRetryFetch,
  stringifyTelegramForm,
} from "./transport/retryPolicy.js";
import { TelegramError } from "./transport/telegramErrors.js";

export { TelegramError } from "./transport/telegramErrors.js";

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

    const agents = createTelegramHttpAgents();
    this._defaultAgent = agents.defaultAgent;
    this._longPollAgent = agents.longPollAgent;
    this._sanitize = createTelegramErrorSanitizer(botToken, this._baseUrl);
  }

  /** Closes underlying keep-alive sockets. Safe to call multiple times. */
  close() {
    destroyTelegramHttpAgents({
      defaultAgent: this._defaultAgent,
      longPollAgent: this._longPollAgent,
    });
  }

  /**
   * Replace the bot token and any embedded `api.telegram.org/bot<token>` URL
   * with stable placeholders. Used in both error messages and JSON dumps.
   *
   * @param {string} text
   * @returns {string}
   */
  sanitize(text) {
    return this._sanitize(text);
  }

  /**
   * @param {{
   *   chatId: number | string;
   *   text: string;
   *   parseMode?: string | null;
   *   replyMarkup?: object | null;
   *   disableWebPagePreview?: boolean;
   *   messageEffectId?: string | null;
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
        if (params.parseMode !== null)
          data.parse_mode = params.parseMode || "HTML";
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
   *   messageEffectId?: string | null;
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
        if (params.parseMode !== null)
          data.parse_mode = params.parseMode || "HTML";
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
   * @param {{
   *   chatId: number | string;
   *   markdown: string;
   *   replyMarkup?: object | null;
   *   messageEffectId?: string | null;
   * }} params
   */
  async sendRichMessage(params) {
    return this._sendRichWithFallback({
      methodName: "sendRichMessage",
      markdown: params.markdown,
      buildData: (markdown, { dropEffect = false } = {}) => {
        const data = {
          chat_id: params.chatId,
          rich_message: { markdown },
        };
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
   *   draftId: number;
   *   markdown: string;
   * }} params
   */
  async sendRichMessageDraft(params) {
    const data = {
      chat_id: params.chatId,
      draft_id: params.draftId,
      rich_message: { markdown: params.markdown },
    };
    return this._call("sendRichMessageDraft", {
      data,
      timeoutMs: EDIT_MESSAGE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  /**
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
   * @param {{ chatId: number | string; messageId: number }} params
   */
  async deleteMessage(params) {
    return this._call("deleteMessage", {
      data: {
        chat_id: params.chatId,
        message_id: params.messageId,
      },
      timeoutMs: EDIT_MESSAGE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  /**
   * @param {{
   *   chatId: number | string;
   *   documentPath: string;
   *   caption?: string | null;
   *   messageEffectId?: string | null;
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
    if (params.messageEffectId) {
      form.append("message_effect_id", params.messageEffectId);
    }
    return this._callMultipart("sendDocument", {
      form,
      timeoutMs: SEND_MESSAGE_TIMEOUT_MS,
      maxRetries: SEND_MESSAGE_MAX_RETRIES,
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

  async _sendRichWithFallback({
    methodName,
    markdown,
    buildData,
    timeoutMs,
    maxRetries,
  }) {
    try {
      return await this._call(methodName, {
        data: buildData(markdown),
        timeoutMs,
        maxRetries,
      });
    } catch (err) {
      return retryRichSendAfterTelegramReject({
        err,
        markdown,
        buildData,
        retry: (data) =>
          this._call(methodName, {
            data,
            timeoutMs,
            maxRetries: 0,
          }),
      });
    }
  }

  async _sendOrEditWithFallback({
    methodName,
    text,
    buildData,
    timeoutMs,
    maxRetries,
  }) {
    try {
      return await this._call(methodName, {
        data: buildData(text),
        timeoutMs,
        maxRetries,
      });
    } catch (err) {
      return retrySendOrEditAfterTelegramReject({
        err,
        text,
        buildData,
        retry: (data) =>
          this._call(methodName, {
            data,
            timeoutMs,
            maxRetries: 0,
          }),
      });
    }
  }

  async _callMultipart(methodName, { form, timeoutMs, maxRetries }) {
    return executeTelegramRetryFetch({
      methodName,
      baseUrl: this._baseUrl,
      fetchImpl: this._fetch,
      sanitize: this._sanitize,
      sleep: this._sleep,
      backoffBaseMs: this._backoffBaseMs,
      backoffCapMs: this._backoffCapMs,
      requestTimeoutMs: this._requestTimeoutMs,
      maxRetries: this._maxRetries,
      buildInit: () => ({ method: "POST", body: form }),
      agent: this._defaultAgent,
      timeoutMs,
      maxRetriesOverride: maxRetries,
    });
  }

  async _call(methodName, { data, timeoutMs, maxRetries }) {
    const agent =
      methodName === LONG_POLL_METHOD
        ? this._longPollAgent
        : this._defaultAgent;
    return executeTelegramRetryFetch({
      methodName,
      baseUrl: this._baseUrl,
      fetchImpl: this._fetch,
      sanitize: this._sanitize,
      sleep: this._sleep,
      backoffBaseMs: this._backoffBaseMs,
      backoffCapMs: this._backoffCapMs,
      requestTimeoutMs: this._requestTimeoutMs,
      maxRetries: this._maxRetries,
      buildInit: () => ({
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(stringifyTelegramForm(data)).toString(),
      }),
      agent,
      timeoutMs,
      maxRetriesOverride: maxRetries,
    });
  }
}
