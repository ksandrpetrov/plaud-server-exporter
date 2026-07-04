/**
 * features/audioExport/extensionDownloadBridge.js
 * chrome.downloads bridge from content script context.
 */
import { withUtf8Bom } from "../../common/exportPathUtils.js";
import { normalizeHumanTitle } from "../../common/plaudTitles.js";
import { ACTION_DOWNLOAD_PLAUD_FILE } from "../../common/runtimeMessages.js";
import {
  fetchWithTimeout,
  PLAUD_FETCH_TIMEOUT_MS,
  plaudExportDebug,
} from "./plaudBrowserApi.js";
import { buildSummaryFilename } from "./plaudCollisionPaths.js";

export function buildSummaryFilenameForFile(
  markdown,
  fallbackTitle,
  index = 0,
  file = null
) {
  return buildSummaryFilename(
    markdown,
    fallbackTitle,
    index,
    file,
    normalizeHumanTitle
  );
}

function requestDownloadViaBackground(payload) {
  return new Promise((resolve, reject) => {
    const urlSchemeMatch =
      typeof payload.url === "string"
        ? payload.url.match(/^([a-z0-9+.-]+):/i)
        : null;
    plaudExportDebug("download:background:request", {
      filename: payload.filename,
      conflictAction: payload.conflictAction,
      hasUrl: typeof payload.url === "string" && !!payload.url,
      urlScheme: urlSchemeMatch?.[1] || "",
      hasTextContent: payload.textContent != null,
      textChars:
        payload.textContent == null ? 0 : String(payload.textContent).length,
    });
    chrome.runtime.sendMessage(
      {
        action: ACTION_DOWNLOAD_PLAUD_FILE,
        ...payload,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          plaudExportDebug("download:background:last-error", {
            filename: payload.filename,
            message: chrome.runtime.lastError.message,
          });
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.success) {
          plaudExportDebug("download:background:rejected", {
            filename: payload.filename,
            response,
          });
          reject(new Error(response?.error || "Ошибка загрузки."));
          return;
        }
        plaudExportDebug("download:background:success", {
          filename: response.filename || payload.filename,
          downloadId: response.downloadId,
          conflictAction: response.conflictAction,
        });
        resolve(response);
      }
    );
  });
}

export async function downloadTextViaBackground(
  content,
  filename,
  options = {}
) {
  const text = withUtf8Bom(content);
  plaudExportDebug("summary:download:start", {
    filename,
    markdownChars: String(content ?? "").length,
    bytes: new TextEncoder().encode(text).byteLength,
    transport: "textContent",
  });
  // Inline text via sendMessage → SW builds a data: URL. Blob object URLs from
  // the content script are not reliably readable in Safari's service worker.
  return await requestDownloadViaBackground({
    textContent: text,
    mimeType: "text/markdown;charset=utf-8",
    filename,
    conflictAction: options.conflictAction,
  });
}

/**
 * URL download via chrome.downloads; on failure fetches the file in the page
 * context (presigned URLs / cookies) and hands the service worker a blob
 * object URL. Raw bytes must not be relayed through chrome.runtime.sendMessage:
 * messages are JSON-serialized, so an ArrayBuffer arrives as `{}`. The object
 * URL is created here because MV3 service workers have no URL.createObjectURL.
 */
export async function downloadViaBackground(url, filename, options = {}) {
  const basePayload = {
    filename,
    conflictAction: options.conflictAction,
  };
  try {
    return await requestDownloadViaBackground({ ...basePayload, url });
  } catch (directError) {
    let response;
    try {
      response = await fetchWithTimeout(url, {}, PLAUD_FETCH_TIMEOUT_MS);
    } catch {
      throw directError;
    }
    if (!response.ok) {
      throw new Error(
        `${directError.message} (повтор через fetch: HTTP ${response.status})`,
        { cause: directError }
      );
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      // The bridge waits for download completion, so revoking afterwards is safe.
      return await requestDownloadViaBackground({
        ...basePayload,
        url: blobUrl,
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
}
