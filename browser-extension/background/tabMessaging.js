/**
 * Thin promise wrappers around `chrome.tabs.sendMessage` and
 * `chrome.scripting.executeScript`, plus a re-injection retry loop used when
 * the content script went away after a tab discard.
 *
 * No global state — safe to import from any service-worker module.
 */

import { plaudT } from "./bgLocale.js";

export function delayMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Detects the “tab has no listener” class of errors so callers can re-inject. */
export function isMissingReceivingEndError(error) {
  return (
    error?.message &&
    (error.message.includes("Receiving end does not exist") ||
      error.message.includes("Could not establish connection"))
  );
}

/**
 * Promise-style `chrome.tabs.sendMessage`. Rejects when `chrome.runtime.lastError`
 * is set (e.g. tab discarded, content script never loaded).
 *
 * @param {number} tabId
 * @param {unknown} payload
 */
export function sendTabMessage(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/** Re-injects `content.js` into a tab; used when the previous instance died. */
export function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"],
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(undefined);
      }
    );
  });
}

/**
 * Sends `payload` to `tabId`, and on "missing receiving end" re-injects
 * `content.js` and retries up to 5 times with 250ms backoff. Keeps the two
 * background → content dispatchers (export / smart-sync) DRY.
 *
 * @param {number} tabId
 * @param {object} payload
 */
export async function sendTabMessageWithRecovery(tabId, payload) {
  try {
    return await sendTabMessage(tabId, payload);
  } catch (error) {
    if (!isMissingReceivingEndError(error)) {
      throw error;
    }
  }

  await injectContentScript(tabId);

  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await sendTabMessage(tabId, payload);
    } catch (error) {
      lastError = error;
      if (!isMissingReceivingEndError(error)) {
        throw error;
      }
      await delayMs(250);
    }
  }

  throw lastError || new Error(plaudT("bg.pageNotResponding"));
}
