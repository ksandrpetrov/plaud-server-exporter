import {
  normalizeHexRecordingId,
  collectDomRecordingHexIds,
  RAW_FILE_ID_RE,
} from "../../common/plaudRecordingIds.js";

/**
 * First 32-hex id found in a string (pathname or full URL).
 * @param {string} s
 * @returns {string} normalized id or ""
 */
function findHexIdInString(s) {
  if (!s) return "";
  const m = String(s).match(/\b[a-f0-9]{32}\b/i);
  if (!m) return "";
  return RAW_FILE_ID_RE.test(m[0]) ? m[0].toLowerCase() : "";
}

/**
 * Resolves the recording open on the current Plaud Web page for single-file export.
 * @returns {{ id: string, title?: string } | null}
 */
export function resolveCurrentRecording() {
  if (typeof window === "undefined" || !window.location) {
    return null;
  }

  const href = window.location.href || "";
  const path = window.location.pathname || "";

  let id =
    normalizeHexRecordingId(findHexIdInString(path)) ||
    normalizeHexRecordingId(findHexIdInString(href));

  if (!id) {
    const domIds = collectDomRecordingHexIds();
    if (domIds.length === 1) {
      id = domIds[0];
    } else if (domIds.length > 1) {
      const inHref = domIds.find((d) => href.includes(d));
      id = inHref || "";
    }
  }

  if (!id) return null;

  let title = "";
  if (typeof document !== "undefined" && document.title) {
    title = document.title
      .replace(/\s*[|•]\s*Plaud\.ai.*$/i, "")
      .replace(/\s*—\s*Plaud.*$/i, "")
      .trim();
  }

  return { id, ...(title ? { title } : {}) };
}
