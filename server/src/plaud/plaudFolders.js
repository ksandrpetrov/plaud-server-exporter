/**
 * Plaud virtual folders (filetags) — mirrors extension logic for /filetag/ and
 * per-folder list pulls. Recording rows expose `filetag_id_list` (see arbuzmell/plaud-api).
 */
import { sanitizePathSegment } from "../../../plaud-exporter/common/exportPathUtils.js";

/** Vault subfolder names aligned with Plaud sidebar groups. */
export const PLAUD_FOLDER_UNFILED = "Unfiled";
export const PLAUD_FOLDER_TRASH = "Trash";

const FILETAG_ID_KEYS = [
  "filetag_id_list",
  "filetag_ids",
  "filetagIds",
  "file_tag_id_list",
  "file_tag_ids",
  "tag_id_list",
  "tag_ids",
  "tagIds",
  "folder_id_list",
  "folder_ids",
];

const SINGLE_FILETAG_KEYS = [
  "filetag_id",
  "file_tag_id",
  "fileTagId",
  "tag_id",
  "folder_id",
];

export function extractTagId(tag) {
  if (!tag || typeof tag !== "object") return "";
  const id = tag.id ?? tag.filetag_id ?? tag.tag_id ?? tag.folder_id;
  return id != null ? String(id).trim() : "";
}

export function extractTagName(tag) {
  if (!tag || typeof tag !== "object") return "";
  return String(
    tag.name ?? tag.tag_name ?? tag.title ?? tag.folder_name ?? ""
  ).trim();
}

/**
 * @param {object} raw
 * @returns {string[]}
 */
export function extractFiletagIdsFromRaw(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const ids = new Set();

  for (const key of FILETAG_ID_KEYS) {
    const value = raw[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const s = String(item ?? "").trim();
        if (s) ids.add(s);
      }
    }
  }

  for (const key of SINGLE_FILETAG_KEYS) {
    const value = raw[key];
    if (value == null) continue;
    const s = String(value).trim();
    if (s) ids.add(s);
  }

  if (Array.isArray(raw.tags)) {
    for (const tag of raw.tags) {
      if (typeof tag === "string" || typeof tag === "number") {
        const s = String(tag).trim();
        if (s) ids.add(s);
        continue;
      }
      const id = extractTagId(tag);
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

export function mergeFiletagIds(...lists) {
  const ids = new Set();
  for (const list of lists) {
    for (const id of list || []) {
      const s = String(id ?? "").trim();
      if (s) ids.add(s);
    }
  }
  return [...ids];
}

function isFiletagLikeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return !!extractTagId(value);
}

function collectQualifyingFiletagArrays(payload) {
  const collected = [];

  function pushIfQualifies(candidate) {
    if (!Array.isArray(candidate) || candidate.length === 0) return;
    if (!candidate.some(isFiletagLikeObject)) return;
    collected.push(candidate);
  }

  const directCandidates = [
    payload?.data?.data_filetag_list,
    payload?.data?.filetag_list,
    payload?.data?.tags,
    payload?.data?.folders,
    payload?.data?.folder_list,
    payload?.data?.list,
    payload?.data?.items,
    payload?.data_filetag_list,
    payload?.filetag_list,
    payload?.tags,
  ];

  for (const candidate of directCandidates) {
    pushIfQualifies(candidate);
  }

  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      pushIfQualifies(value);
      value.forEach(walk);
      return;
    }
    Object.values(value).forEach(walk);
  }
  walk(payload);

  const dedup = [];
  const seenArr = new Set();
  for (const arr of collected) {
    if (seenArr.has(arr)) continue;
    seenArr.add(arr);
    dedup.push(arr);
  }
  return dedup;
}

function findFiletagArray(payload) {
  const byId = new Map();
  for (const arr of collectQualifyingFiletagArrays(payload)) {
    for (const tag of arr) {
      if (!isFiletagLikeObject(tag)) continue;
      const id = extractTagId(tag);
      if (!id || byId.has(id)) continue;
      byId.set(id, tag);
    }
  }
  return [...byId.values()];
}

export function mergeFiletagsById(tagArrays) {
  const byId = new Map();
  for (const tags of tagArrays) {
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (!isFiletagLikeObject(tag)) continue;
      const id = extractTagId(tag);
      if (!id || byId.has(id)) continue;
      byId.set(id, tag);
    }
  }
  return [...byId.values()];
}

/** @param {object[]} tags */
export function collectUnfiledFiletagIds(tags) {
  const ids = new Set();

  function addFromTag(tag) {
    const id = extractTagId(tag);
    if (id) ids.add(id);
  }

  if (!Array.isArray(tags)) return [];

  for (const tag of tags) {
    if (!tag || typeof tag !== "object") continue;
    if (
      tag.is_unfiled === true ||
      tag.unfiled === true ||
      tag.is_unclassified === true ||
      tag.is_untagged === true ||
      tag.unclassified === true ||
      tag.is_inbox === true
    ) {
      addFromTag(tag);
    }
  }

  for (const tag of tags) {
    if (!tag || typeof tag !== "object") continue;
    const sysKind = String(
      tag.system_folder_type ??
        tag.sys_folder_type ??
        tag.folder_kind ??
        tag.tag_kind ??
        ""
    ).toLowerCase();
    if (
      sysKind.includes("unfile") ||
      sysKind.includes("inbox") ||
      sysKind.includes("untagged")
    ) {
      addFromTag(tag);
    }
  }

  const namePatterns = [
    /unfiled/i,
    /^untagged$/i,
    /^inbox$/i,
    /^без\s*папки$/i,
    /^без\s*категори/i,
    /^без\s*тег/i,
    /^несортирован/i,
    /^не\s*разобран/i,
    /uncategorized/i,
    /^sin\s+carpeta$/i,
    /^ohne\s+ordner$/i,
    /^未分类$/,
    /^未归档$/,
  ];

  for (const tag of tags) {
    if (!tag || typeof tag !== "object") continue;
    const name = extractTagName(tag);
    if (!name) continue;
    if (namePatterns.some((re) => re.test(name))) {
      addFromTag(tag);
    }
  }

  for (const tag of tags) {
    if (!tag || typeof tag !== "object") continue;
    const typ = String(tag.type ?? tag.tag_type ?? "").toLowerCase();
    if (
      typ.includes("unfile") ||
      typ.includes("untagged") ||
      typ.includes("inbox")
    ) {
      addFromTag(tag);
    }
  }

  return [...ids];
}

function isTrashSidebarTag(tag) {
  if (!tag || typeof tag !== "object") return false;
  const name = String(tag.name ?? tag.tag_name ?? "").toLowerCase();
  return /\btrash\b|\brecycle\b|корзина/i.test(name);
}

/**
 * @param {object} raw
 * @returns {boolean}
 */
export function isRecordingInTrash(raw) {
  if (!raw || typeof raw !== "object") return false;
  const v = raw.is_trash ?? raw.isTrash ?? raw.in_trash ?? raw.trashed;
  return v === true || v === 1 || v === "1";
}

export function parseFiletagListPayload(payload) {
  return findFiletagArray(payload);
}

/**
 * @param {Map<string, object>} tagById
 * @param {Set<string>} unfiledIds
 * @param {string[]} folderIds
 * @returns {string} Sanitized single path segment, or "" for vault root under Plaud/
 */
export function resolveFolderPathSegment(folderIds, tagById, unfiledIds) {
  const ids = (folderIds || []).map((id) => String(id).trim()).filter(Boolean);
  if (!ids.length) return PLAUD_FOLDER_UNFILED;

  const nonUnfiled = ids.filter((id) => !unfiledIds.has(id));
  const chosen = nonUnfiled[0] || ids[0];
  const tag = tagById.get(chosen);
  const rawName = extractTagName(tag);

  if (unfiledIds.has(chosen)) {
    return PLAUD_FOLDER_UNFILED;
  }

  if (!rawName) return PLAUD_FOLDER_UNFILED;

  return sanitizePathSegment(rawName, { fallback: "Folder", maxLength: 80 });
}

/**
 * Plaud virtual folder for export / sync-index (Trash → Unfiled → user folder).
 *
 * @param {{
 *   folderIds?: string[];
 *   raw?: object;
 *   tagById: Map<string, object>;
 *   unfiledIds: Set<string>;
 * }} input
 * @returns {string}
 */
export function resolveFileFolderSegment({ folderIds, raw, tagById, unfiledIds }) {
  if (isRecordingInTrash(raw)) return PLAUD_FOLDER_TRASH;
  return resolveFolderPathSegment(folderIds, tagById, unfiledIds);
}

/**
 * @param {object[]} tags
 * @returns {Map<string, object>}
 */
export function buildTagByIdMap(tags) {
  const map = new Map();
  for (const tag of tags || []) {
    if (isTrashSidebarTag(tag)) continue;
    const id = extractTagId(tag);
    if (id) map.set(id, tag);
  }
  return map;
}

export { isTrashSidebarTag };
