import { join, relative, resolve } from "node:path";
import {
  extractTitleFromMarkdown,
  isBoilerplateTitle,
  MARKDOWN_EXTENSION,
  MAX_FILENAME_WITH_EXTENSION,
  sanitizePathSegment,
  truncateToGraphemes,
} from "../../../browser-extension/common/exportPathUtils.js";
import { config, effectiveVaultRoot } from "../config/config.js";

/**
 * Resolves a human-readable meeting title for filenames and sync-index.
 *
 * @param {{
 *   plaudTitle?: string;
 *   summaries?: Array<{ markdown?: string }>;
 *   createdAt?: string;
 * }} input
 * @returns {string}
 */
export function resolveMeetingTitle(input = {}) {
  const plaudTitle = String(input.plaudTitle || "").trim();
  if (plaudTitle && !isBoilerplateTitle(plaudTitle)) {
    return plaudTitle;
  }

  for (const summary of input.summaries || []) {
    const fromMd = extractTitleFromMarkdown(summary?.markdown || "");
    if (fromMd && !isBoilerplateTitle(fromMd)) return fromMd;
  }

  const dateOnly = formatDateOnly(input.createdAt);
  if (dateOnly) return `${dateOnly} Plaud summary`;
  return "Plaud summary";
}

function formatDateOnly(isoLike) {
  const date = isoLike ? new Date(isoLike) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

/**
 * Builds the dated filename base: `YYYY-MM-DD - Title`.
 *
 * @param {{ title: string; createdAt?: string; maxTitleLength?: number }} input
 */
export function buildDatedFilenameBase({ title, createdAt, maxTitleLength }) {
  const dateOnly = formatDateOnly(createdAt);
  const prefix = dateOnly ? `${dateOnly} - ` : "";
  const titleBudget =
    maxTitleLength ??
    Math.max(
      40,
      MAX_FILENAME_WITH_EXTENSION - MARKDOWN_EXTENSION.length - prefix.length
    );
  const safeTitle = sanitizePathSegment(title, {
    fallback: "Plaud summary",
    maxLength: titleBudget,
  });
  let base = `${prefix}${safeTitle}`;
  const maxBase = MAX_FILENAME_WITH_EXTENSION - MARKDOWN_EXTENSION.length;
  if (base.length > maxBase) {
    const titlePart = truncateToGraphemes(safeTitle, Math.max(20, titleBudget));
    base = `${prefix}${titlePart}`.trimEnd();
    base = sanitizePathSegment(base.replace(/^[\d-]+\s*-\s*/, ""), {
      fallback: "Plaud summary",
      maxLength: maxBase - prefix.length,
    });
    base = prefix + base;
    if (base.length > maxBase) {
      base = truncateToGraphemes(base, maxBase).trimEnd();
    }
  }
  return { base, dateOnly, prefix, safeTitle };
}

/**
 * @param {string} base Stem of the filename without extension.
 * @param {string} filename Initially proposed filename (with extension).
 * @param {Set<string> | undefined} occupiedFilenames Lowercased existing names.
 * @param {string | undefined} stableId Plaud recording id used for disambiguation.
 * @returns {{ base: string, filename: string }}
 */
function applyFilenameCollision(base, filename, occupiedFilenames, stableId) {
  if (!occupiedFilenames?.has(filename.toLowerCase())) {
    return { base, filename };
  }
  const suffix = stableId
    ? sanitizePathSegment(stableId.split(":").pop() || "dup", {
        fallback: "dup",
        maxLength: 12,
      })
    : "dup";
  const ext = MARKDOWN_EXTENSION;
  const stem = base.slice(0, Math.max(20, base.length - suffix.length - 3));
  return { base: stem, filename: `${stem} (${suffix})${ext}` };
}

export function planSummaryPath({
  title,
  createdAt,
  occupiedFilenames,
  stableId,
  folderSegment = "",
}) {
  const vault = effectiveVaultRoot();
  const plaudRoot = resolve(vault, config.obsidianSubfolder || "Plaud");
  const baseDir = folderSegment ? join(plaudRoot, folderSegment) : plaudRoot;
  let titleForPath = title;
  let titleBudget;
  let lastPlanned = null;

  const pathFilenameCap = maxFilenameLengthForDir(baseDir);

  for (let attempt = 0; attempt < 10; attempt++) {
    const prefixLen = formatDateOnly(createdAt) ? 13 : 0;
    const titleCap = Math.min(
      titleBudget ??
        Math.max(
          40,
          MAX_FILENAME_WITH_EXTENSION - MARKDOWN_EXTENSION.length - prefixLen
        ),
      pathFilenameCap - MARKDOWN_EXTENSION.length - prefixLen
    );

    let { base, dateOnly } = buildDatedFilenameBase({
      title: titleForPath,
      createdAt,
      maxTitleLength: Math.max(20, titleCap),
    });
    let filename = `${base}${MARKDOWN_EXTENSION}`;
    if (filename.length > pathFilenameCap) {
      const stemBudget = Math.max(
        20,
        pathFilenameCap - MARKDOWN_EXTENSION.length
      );
      base = truncateToGraphemes(base, stemBudget);
      filename = `${base}${MARKDOWN_EXTENSION}`;
    }
    ({ filename } = applyFilenameCollision(
      base,
      filename,
      occupiedFilenames,
      stableId
    ));

    const absoluteDir = baseDir;
    const absolutePath = join(absoluteDir, filename);
    const relativePath = relative(vault, absolutePath);
    lastPlanned = {
      absolutePath,
      relativePath,
      filename,
      dateOnly,
      normalizedFilename: filename,
    };

    if (fitsPathLengthBudget(absolutePath)) {
      return lastPlanned;
    }

    const currentBudget =
      titleBudget ??
      Math.max(
        40,
        MAX_FILENAME_WITH_EXTENSION - MARKDOWN_EXTENSION.length - prefixLen
      );
    titleBudget = Math.max(20, Math.floor(currentBudget * 0.85));
    titleForPath = truncateToGraphemes(String(title || ""), titleBudget);
  }

  return lastPlanned;
}

/** Conservative full-path limit (~5% below Windows MAX_PATH 260). */
export const MAX_FULL_PATH_LENGTH = 240;

/**
 * @param {string} absolutePath
 * @param {{ maxFullPathLength?: number }} [options]
 */

export function fitsPathLengthBudget(absolutePath, options = {}) {
  const max = options.maxFullPathLength ?? MAX_FULL_PATH_LENGTH;
  return absolutePath.length <= max;
}

function maxFilenameLengthForDir(absoluteDir) {
  const overhead = absoluteDir.length + 1;

  // Linux limits a single filename segment by bytes, not JS string length.
  // Cyrillic and temporary suffixes like `.tmp-<pid>-<timestamp>` can overflow
  // ext4's 255-byte segment limit even when character length looks safe.
  // Keep this conservative until filename planning becomes byte-aware.
  const SAFE_FILENAME_WITH_EXTENSION = 90;

  return Math.max(
    40,
    Math.min(
      MAX_FILENAME_WITH_EXTENSION,
      SAFE_FILENAME_WITH_EXTENSION,
      MAX_FULL_PATH_LENGTH - overhead
    )
  );
}

export function collectOccupiedFilenames(syncIndex, excludeStableId = "") {
  const occupied = new Set();
  for (const [id, record] of Object.entries(syncIndex?.records || {})) {
    if (id === excludeStableId) continue;
    const name = record?.normalizedFilename || "";
    if (name) occupied.add(String(name).toLowerCase());
  }
  return occupied;
}
