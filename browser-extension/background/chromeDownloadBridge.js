/**
 * Wraps `chrome.downloads` into promise-based helpers used by the SW to
 * fulfill `downloadPlaudFile` messages from the content / audioExport script.
 *
 * No state — every call resolves a single download.
 */

import {
  AUDIO_SUBDIRECTORY,
  sanitizeDownloadFilename,
} from "../common/exportPathUtils.js";
import { plaudT } from "./bgLocale.js";

const VALID_CONFLICT_ACTIONS = ["uniquify", "overwrite", "prompt"];

function getUrlSchemeForLog(value) {
  if (typeof value !== "string") return "";
  return value.match(/^([a-z0-9+.-]+):/i)?.[1] || "";
}

/** Kicks off a `chrome.downloads.download`; rejects on error or empty id. */
function startChromeDownload(options) {
  return new Promise((resolve, reject) => {
    console.info("[Plaud Export BG] chrome.downloads.download:start", {
      filename: options.filename,
      conflictAction: options.conflictAction,
      saveAs: options.saveAs,
      urlScheme: getUrlSchemeForLog(options.url),
    });
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn("[Plaud Export BG] chrome.downloads.download:error", {
          filename: options.filename,
          message: chrome.runtime.lastError.message,
        });
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!downloadId) {
        console.warn("[Plaud Export BG] chrome.downloads.download:no-id", {
          filename: options.filename,
        });
        reject(new Error(plaudT("bg.noDownloadId")));
        return;
      }
      console.info("[Plaud Export BG] chrome.downloads.download:started", {
        filename: options.filename,
        downloadId,
      });
      resolve(downloadId);
    });
  });
}

/** Resolves when the download completes; rejects on interruption / timeout. */
function waitForChromeDownload(downloadId, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollIntervalId = null;
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(plaudT("bg.downloadTimeout", { id: downloadId })));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutId);
      if (pollIntervalId != null) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      chrome.downloads.onChanged.removeListener(onChanged);
    }

    function finishComplete() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }

    function finishInterrupted(reasonSuffix = "") {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          plaudT("bg.downloadInterrupted", { id: downloadId }) + reasonSuffix
        )
      );
    }

    function inspectDownloadState(items) {
      const item = items?.[0];
      if (!item?.state) return;
      if (item.state === "complete") {
        finishComplete();
      } else if (item.state === "interrupted") {
        finishInterrupted(item.error ? ` (${item.error})` : "");
      }
    }

    function pollDownloadState() {
      if (!chrome.downloads?.search) return;
      chrome.downloads.search({ id: downloadId }, (items) => {
        if (chrome.runtime.lastError || settled) return;
        inspectDownloadState(items);
      });
    }

    function onChanged(delta) {
      if (delta.id !== downloadId || !delta.state || settled) return;

      if (delta.state.current === "complete") {
        finishComplete();
      } else if (delta.state.current === "interrupted") {
        const reason = delta.error?.current ? ` (${delta.error.current})` : "";
        finishInterrupted(reason);
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);
    // Safari often skips onChanged for data:/blob downloads; poll as backup.
    pollDownloadState();
    pollIntervalId = setInterval(pollDownloadState, 400);
  });
}

/**
 * MV3 service workers have no URL.createObjectURL, so inline text is turned
 * into a `data:` URL instead. Larger payloads should reach the SW as blob
 * object URLs created by the content script.
 */
function bytesToDataUrl(bytes, mimeType) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * Top-level entry point invoked by the SW when content / audioExport asks
 * the SW to perform a download via `ACTION_DOWNLOAD_PLAUD_FILE`. Handles
 * both URL downloads and inline-text downloads (the latter via a `data:` URL).
 */
export async function downloadPlaudFile(message) {
  if (typeof chrome.downloads?.download !== "function") {
    throw new Error(plaudT("bg.downloadsUnsupported"));
  }

  const requestedConflictAction = String(message.conflictAction || "uniquify");
  const conflictAction = VALID_CONFLICT_ACTIONS.includes(
    requestedConflictAction
  )
    ? requestedConflictAction
    : "uniquify";
  const filename = sanitizeDownloadFilename(
    message.filename || `${AUDIO_SUBDIRECTORY}/plaud-audio.audio.mp3`
  );

  let url = message.url;
  if (message.textContent != null) {
    const bytes = new TextEncoder().encode(String(message.textContent));
    const mimeType = String(message.mimeType || "text/plain;charset=utf-8");
    url = bytesToDataUrl(bytes, mimeType);
  }

  if (!url) {
    throw new Error(plaudT("bg.noUrl"));
  }

  console.info("[Plaud Export BG] downloadPlaudFile:start", {
    filename,
    conflictAction,
    urlScheme: getUrlSchemeForLog(url),
    hasInlineText: message.textContent != null,
    inlineTextChars:
      message.textContent == null ? 0 : String(message.textContent).length,
  });
  const downloadId = await startChromeDownload({
    url,
    filename,
    conflictAction,
    saveAs: false,
  });

  await waitForChromeDownload(downloadId, Number(message.timeoutMs) || 600000);
  console.info("[Plaud Export BG] downloadPlaudFile:complete", {
    filename,
    downloadId,
    conflictAction,
  });
  return { success: true, downloadId, filename, conflictAction };
}
