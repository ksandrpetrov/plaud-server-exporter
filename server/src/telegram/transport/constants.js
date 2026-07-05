export const TELEGRAM_API = "https://api.telegram.org";

export const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export const SEND_MESSAGE_TIMEOUT_MS = 8000;
export const SEND_MESSAGE_MAX_RETRIES = 1;
export const EDIT_MESSAGE_TIMEOUT_MS = 3000;
export const EDIT_MESSAGE_MAX_RETRIES = 0;
export const LONG_POLL_METHOD = "getUpdates";
