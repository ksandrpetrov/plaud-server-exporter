/**
 * Wraps `chrome.downloads` into promise-based helpers used by the SW to
 * fulfill `downloadPlaudFile` messages from the content / audioExport script.
 *
 * No state — every call resolves a single download.
 */

import { AUDIO_SUBDIRECTORY, sanitizeDownloadFilename } from "../common/exportPathUtils.js";
import { plaudT } from "./bgLocale.js";

const VALID_CONFLICT_ACTIONS = ["uniquify", "overwrite", "prompt"];

/** Kicks off a `chrome.downloads.download`; rejects on error or empty id. */
function startChromeDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!downloadId) {
        reject(new Error(plaudT("bg.noDownloadId")));
        return;
      }
      resolve(downloadId);
    });
  });
}

/** Resolves when the download completes; rejects on interruption / timeout. */
function waitForChromeDownload(downloadId, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(plaudT("bg.downloadTimeout", { id: downloadId })));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutId);
      chrome.downloads.onChanged.removeListener(onChanged);
    }

    function onChanged(delta) {
      if (delta.id !== downloadId || !delta.state) return;

      if (delta.state.current === "complete") {
        cleanup();
        resolve();
      } else if (delta.state.current === "interrupted") {
        cleanup();
        const reason = delta.error?.current
          ? ` (${delta.error.current})`
          : "";
        reject(
          new Error(plaudT("bg.downloadInterrupted", { id: downloadId }) + reason)
        );
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);
  });
}

/**
 * Top-level entry point invoked by the SW when content / audioExport asks
 * the SW to perform a download via `ACTION_DOWNLOAD_PLAUD_FILE`. Handles
 * both URL downloads and inline-text downloads (the latter via a transient
 * blob object URL).
 */
export async function downloadPlaudFile(message) {
  const requestedConflictAction = String(message.conflictAction || "uniquify");
  const conflictAction = VALID_CONFLICT_ACTIONS.includes(requestedConflictAction)
    ? requestedConflictAction
    : "uniquify";
  const filename = sanitizeDownloadFilename(
    message.filename || `${AUDIO_SUBDIRECTORY}/plaud-audio.audio.mp3`
  );

  let url = message.url;
  let revokeObjectUrl = null;
  if (message.textContent != null) {
    const bytes = new TextEncoder().encode(String(message.textContent));
    const mimeType = String(message.mimeType || "text/plain;charset=utf-8");
    const blob = new Blob([bytes], { type: mimeType });
    url = URL.createObjectURL(blob);
    revokeObjectUrl = url;
  }

  if (!url) {
    throw new Error(plaudT("bg.noUrl"));
  }

  try {
    const downloadId = await startChromeDownload({
      url,
      filename,
      conflictAction,
      saveAs: false,
    });

    await waitForChromeDownload(downloadId, Number(message.timeoutMs) || 600000);
    return { success: true, downloadId, filename, conflictAction };
  } finally {
    if (revokeObjectUrl) {
      URL.revokeObjectURL(revokeObjectUrl);
    }
  }
}
