import { plaudT } from "./bgLocale.js";
import { createExportHandlers } from "./handlers/exportHandlers.js";
import { createSettingsHandlers } from "./handlers/settingsHandlers.js";
import { createSmartSyncHandlers } from "./handlers/smartSyncHandlers.js";
import { createStatusHandlers } from "./handlers/statusHandlers.js";

/**
 * @param {(...args: unknown[]) => void} plaudBgLog
 */
export function registerMessageRouter(plaudBgLog) {
  const handlers = {
    ...createExportHandlers(plaudBgLog),
    ...createSmartSyncHandlers(),
    ...createSettingsHandlers(),
    ...createStatusHandlers(),
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    plaudBgLog("Background received message:", message.action);

    try {
      const handler = handlers[message.action];
      if (handler) {
        return handler(message, sender, sendResponse);
      }

      console.warn("Unrecognized message action received:", message.action);
      sendResponse({ success: false, error: plaudT("bg.unknownAction") });
      return false;
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
      return false;
    }
  });
}
