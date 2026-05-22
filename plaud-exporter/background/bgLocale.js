/**
 * Locale state for service-worker logs and `chrome.notifications` strings.
 *
 * Single owner of `plaudUiLocale`; any helper that needs to render a localized
 * message imports `plaudT` from here instead of touching `globalThis.PlaudI18n`
 * directly. Mirrors the popup pattern (locale comes from `chrome.storage.sync`,
 * falls back to navigator language).
 *
 * The service worker imports `common/plaud-i18n-messages.js` for its side
 * effect of populating `globalThis.PlaudI18n`; we must therefore be loaded
 * AFTER that import (handled by `background.js` import order).
 */

let plaudUiLocale = globalThis.PlaudI18n
  ? globalThis.PlaudI18n.getDefaultLocaleFromNavigator()
  : "en";

/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function plaudT(key, params) {
  const I = globalThis.PlaudI18n;
  if (!I) return key;
  return I.t(plaudUiLocale, key, params);
}

/**
 * Reads the user-selected locale from `chrome.storage.sync` (or falls back
 * to the browser's UI language) and updates the module-local state.
 *
 * @param {() => void} [callback]
 */
export function syncPlaudLocale(callback) {
  const I = globalThis.PlaudI18n;
  if (!I || !chrome.storage?.sync) {
    plaudUiLocale = I ? I.getDefaultLocaleFromNavigator() : "en";
    if (callback) callback();
    return;
  }
  chrome.storage.sync.get([I.STORAGE_KEY], function (result) {
    const v = result[I.STORAGE_KEY];
    if (v === "ru" || v === "en") {
      plaudUiLocale = v;
    } else {
      plaudUiLocale = I.getDefaultLocaleFromNavigator();
    }
    if (callback) callback();
  });
}

/**
 * Subscribe to `chrome.storage.sync` changes so the bot picks up locale
 * switches without a restart. Idempotent — call once at SW boot.
 */
export function attachLocaleChangeListener() {
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "sync") return;
    const I = globalThis.PlaudI18n;
    if (!I || !changes[I.STORAGE_KEY]) return;
    const nv = changes[I.STORAGE_KEY].newValue;
    if (nv === "ru" || nv === "en") plaudUiLocale = nv;
  });
}
