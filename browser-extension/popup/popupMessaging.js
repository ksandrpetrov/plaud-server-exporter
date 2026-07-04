(function (global) {
  "use strict";

  const PP = global.PlaudPopup;

  /**
   * @param {ReturnType<typeof PP.createState>} ctx
   */
  PP.initMessaging = function initMessaging(ctx) {
    ctx.sendMessageToTab = function sendMessageToTab(tabId, payload, callback) {
      if (!ctx.hasChromeExtensionApi) {
        callback(new Error(ctx.tr("error.apiUnavailable")), null);
        return;
      }
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          callback(new Error(chrome.runtime.lastError.message), null);
          return;
        }
        callback(null, response);
      });
    };

    ctx.sendRuntimeMessage = function sendRuntimeMessage(payload, callback) {
      if (!ctx.hasChromeExtensionApi) {
        callback(new Error(ctx.tr("error.apiUnavailable")), null);
        return;
      }
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          callback(new Error(chrome.runtime.lastError.message), null);
          return;
        }
        callback(null, response);
      });
    };

    ctx.injectContentScript = function injectContentScript(tabId, callback) {
      if (!ctx.hasChromeExtensionApi) {
        callback(new Error(ctx.tr("error.apiUnavailable")));
        return;
      }
      chrome.scripting.executeScript(
        { target: { tabId }, files: ["content.js"] },
        () => {
          if (chrome.runtime.lastError) {
            callback(new Error(chrome.runtime.lastError.message));
            return;
          }
          callback(null);
        }
      );
    };

    ctx.isMissingReceivingEndError = function isMissingReceivingEndError(
      error
    ) {
      return (
        error?.message &&
        (error.message.includes("Receiving end does not exist") ||
          error.message.includes("Could not establish connection"))
      );
    };

    ctx.retrySendMessageToTab = function retrySendMessageToTab(
      tabId,
      payload,
      attemptsRemaining,
      callback
    ) {
      ctx.sendMessageToTab(tabId, payload, (sendError, response) => {
        if (
          !sendError ||
          attemptsRemaining <= 1 ||
          !ctx.isMissingReceivingEndError(sendError)
        ) {
          callback(sendError, response);
          return;
        }
        setTimeout(() => {
          ctx.retrySendMessageToTab(
            tabId,
            payload,
            attemptsRemaining - 1,
            callback
          );
        }, 250);
      });
    };

    ctx.sendMessageToTabWithRecovery = function sendMessageToTabWithRecovery(
      tab,
      payload,
      callback
    ) {
      ctx.sendMessageToTab(tab.id, payload, (sendError, response) => {
        if (!sendError) {
          callback(null, response);
          return;
        }
        if (!ctx.isMissingReceivingEndError(sendError)) {
          callback(sendError, null);
          return;
        }
        ctx.injectContentScript(tab.id, (injectError) => {
          if (injectError) {
            callback(injectError, null);
            return;
          }
          ctx.retrySendMessageToTab(tab.id, payload, 5, callback);
        });
      });
    };

    ctx.runAfterNextPaint = function runAfterNextPaint(fn) {
      requestAnimationFrame(fn);
    };
  };
})(window);
