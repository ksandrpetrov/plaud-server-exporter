import { dirname, relative } from "node:path";
import {
  PLAUD_FOLDER_TRASH,
  PLAUD_FOLDER_UNFILED,
} from "../plaud/plaudFolders.js";

const YEAR_ONLY_SEGMENT_RE = /^\d{4}$/;

/**
 * Display label for a Plaud folder group (user folder, Unfiled, or Trash).
 *
 * @param {string} vaultRelativeDir e.g. `Plaud/SocServ QA` or `Plaud/2026`
 * @param {string} subfolder e.g. `Plaud`
 * @returns {string}
 */
export function plaudFolderLabelFromVaultPath(vaultRelativeDir, subfolder) {
  const sub = String(subfolder || "Plaud").replace(/\\/g, "/");
  let dir = String(vaultRelativeDir || "")
    .replace(/\\/g, "/")
    .trim();

  if (!dir || dir === sub) return PLAUD_FOLDER_UNFILED;
  if (dir.startsWith(`${sub}/`)) dir = dir.slice(sub.length + 1);

  const parts = dir.split("/").filter(Boolean);
  if (!parts.length) return PLAUD_FOLDER_UNFILED;

  if (parts.length === 1 && YEAR_ONLY_SEGMENT_RE.test(parts[0])) {
    return PLAUD_FOLDER_UNFILED;
  }
  if (parts.length > 1 && YEAR_ONLY_SEGMENT_RE.test(parts[0])) {
    return parts.slice(1).join("/") || PLAUD_FOLDER_UNFILED;
  }

  return dir;
}

/**
 * @param {object} record
 * @param {{ vaultRoot?: string; subfolder?: string }} ctx
 * @returns {string}
 */
export function folderLabelFromRecord(record, ctx) {
  const stored = String(record?.folderSegment || "").trim();
  if (stored) return stored;

  const subfolder = String(ctx.subfolder || "Plaud").replace(/\\/g, "/");
  const summaryPath = String(record?.summaryPath || "");
  const vaultRoot = String(ctx.vaultRoot || "");

  if (summaryPath && vaultRoot) {
    const rel = relative(vaultRoot, summaryPath).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..") && rel !== ".") {
      const dir = dirname(rel);
      if (dir && dir !== ".") {
        return plaudFolderLabelFromVaultPath(dir, subfolder);
      }
      return PLAUD_FOLDER_UNFILED;
    }
  }

  return PLAUD_FOLDER_UNFILED;
}

/**
 * Sort: user folders A–Z, then Unfiled, then Trash.
 *
 * @param {string} a
 * @param {string} b
 */
export function comparePlaudFolderLabels(a, b) {
  const rank = (label) => {
    if (label === PLAUD_FOLDER_UNFILED) return 1;
    if (label === PLAUD_FOLDER_TRASH) return 2;
    return 0;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}
