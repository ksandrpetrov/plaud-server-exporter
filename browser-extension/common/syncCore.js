import {
  DEFAULT_SYNC_SUBDIRECTORY,
  sanitizePathSegment,
} from "./exportPathUtils.js";

export const SYNC_INDEX_STORAGE_KEY = "plaudExporterSyncIndexV1";

export const SYNC_STATUS_IDLE = "idle";
export const SYNC_STATUS_LOADING = "loading";
export const SYNC_STATUS_SUCCESS = "success";
export const SYNC_STATUS_ERROR = "error";
export const SYNC_STATUS_ALREADY_SYNCED = "already_synced";
export const SYNC_STATUS_SKIPPED = "skipped";
export const SYNC_STATUS_UPDATED = "updated";

export const SYNC_ACTION_NEW = "new";
export const SYNC_ACTION_ALREADY_SYNCED = "already_synced";
export const SYNC_ACTION_UPDATED = "updated";
export const SYNC_ACTION_SKIPPED = "skipped";

const HIGH_CONFIDENCE_ID_KEYS = [
  "stableId",
  "file_id",
  "fileId",
  "id",
  "recording_id",
  "recordingId",
  "audio_id",
  "audioId",
  "resource_id",
  "resourceId",
  "uuid",
];

const MAX_HASH_SAMPLE_CHARS = 4096;

function cleanString(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePotentialId(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  const compact = raw.replace(/-/g, "").toLowerCase();
  if (/^[a-f0-9]{32}$/.test(compact)) return compact;
  if (/^[a-z0-9][a-z0-9._:-]{5,128}$/i.test(raw)) return raw.toLowerCase();
  return "";
}

function findExplicitId(input) {
  if (!input || typeof input !== "object") return "";
  if (
    typeof input.stableId === "string" &&
    /^(plaud|fingerprint):/i.test(input.stableId.trim())
  ) {
    return input.stableId.trim();
  }
  for (const key of HIGH_CONFIDENCE_ID_KEYS) {
    if (key === "stableId") continue;
    const id = normalizePotentialId(input[key]);
    if (id) return id;
  }
  const raw = input.raw;
  if (raw && typeof raw === "object") {
    for (const key of HIGH_CONFIDENCE_ID_KEYS) {
      const id = normalizePotentialId(raw[key]);
      if (id) return id;
    }
  }
  return "";
}

function canonicalUrl(value, includeQuery = false) {
  const raw = cleanString(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    if (!includeQuery) url.search = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function hashStringSync(value) {
  const text = String(value ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Reads the first non-empty value from `raw` under any of `keys`,
 * trimmed and stringified. Plaud API responses vary between snake_case
 * and camelCase across endpoints; this helper smooths that over.
 */
export function getRawField(raw, keys) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    const value = raw[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

/** Plaud recording timestamps vary by endpoint (snake_case vs camelCase). */
export const RECORDING_CREATED_AT_KEYS = [
  "created_at",
  "createdAt",
  "create_time",
  "createTime",
  "start_time",
  "startTime",
];

export const RECORDING_UPDATED_AT_KEYS = [
  "updated_at",
  "updatedAt",
  "update_time",
  "updateTime",
  "modified_at",
  "modifiedAt",
];

const AUDIO_SIGNATURE_KEYS = {
  size: ["size", "file_size", "fileSize", "audio_size", "audioSize", "bytes"],
  duration: [
    "duration",
    "duration_ms",
    "durationMs",
    "audio_duration",
    "audioDuration",
  ],
  createdAt: [
    "created_at",
    "createdAt",
    "create_time",
    "createTime",
    "start_time",
    "startTime",
  ],
  updatedAt: [
    "updated_at",
    "updatedAt",
    "update_time",
    "updateTime",
    "modified_at",
    "modifiedAt",
  ],
  checksum: ["md5", "sha256", "checksum", "etag"],
};

/**
 * Stable per-recording audio fingerprint used by the sync index. Treats the
 * Plaud `file.id` plus a small set of metadata fields as inputs. Output is
 * deterministic — the same recording shape always yields the same signature.
 * Shared between the Chrome extension and the server CLI so the index is
 * interoperable.
 *
 * @param {{ id?: string; raw?: Record<string, unknown> } | null | undefined} file
 * @returns {string}
 */
export function buildAudioSignature(file) {
  const raw = file?.raw || {};
  const payload = {
    id: file?.id || "",
    size: getRawField(raw, AUDIO_SIGNATURE_KEYS.size),
    duration: getRawField(raw, AUDIO_SIGNATURE_KEYS.duration),
    createdAt: getRawField(raw, AUDIO_SIGNATURE_KEYS.createdAt),
    updatedAt: getRawField(raw, AUDIO_SIGNATURE_KEYS.updatedAt),
    checksum: getRawField(raw, AUDIO_SIGNATURE_KEYS.checksum),
  };
  return `audio-meta:${hashStringSync(JSON.stringify(payload))}`;
}

export function buildFingerprint(fields = {}) {
  const sourceUrl = canonicalUrl(fields.sourceUrl);
  const audioUrl = canonicalUrl(fields.audioUrl);
  const createdAt = cleanString(fields.createdAt || fields.createdDate);
  const title = cleanString(fields.title || fields.originalTitle);
  const summarySample = cleanString(
    fields.summaryMarkdown || fields.summary
  ).slice(0, MAX_HASH_SAMPLE_CHARS);
  const payload = {
    sourceUrl,
    audioUrl,
    createdAt,
    title,
    summarySample,
  };
  return hashStringSync(stableStringify(payload));
}

/**
 * Builds a stable record identity. Plaud API ids are preferred; when unavailable
 * we fall back to a conservative fingerprint based on stable page/content fields.
 *
 * @param {Record<string, any>} input
 * @returns {{ stableId: string; identityKind: "plaud_id" | "fingerprint" | "missing"; confidence: "high" | "medium" | "low"; fingerprint: string }}
 */
export function buildStableId(input = {}) {
  const explicitId = findExplicitId(input);
  if (explicitId) {
    if (/^(plaud|fingerprint):/i.test(explicitId)) {
      const normalizedExplicitId = explicitId.toLowerCase();
      return {
        stableId: normalizedExplicitId,
        identityKind: normalizedExplicitId.startsWith("plaud:")
          ? "plaud_id"
          : "fingerprint",
        confidence: normalizedExplicitId.startsWith("plaud:")
          ? "high"
          : "medium",
        fingerprint: normalizedExplicitId.startsWith("fingerprint:")
          ? normalizedExplicitId.slice("fingerprint:".length)
          : "",
      };
    }
    return {
      stableId: `plaud:${explicitId}`,
      identityKind: "plaud_id",
      confidence: "high",
      fingerprint: "",
    };
  }

  const fingerprint = buildFingerprint(input);
  const hasStrongFallback =
    !!cleanString(input.sourceUrl) &&
    (!!cleanString(input.audioUrl) || !!cleanString(input.summaryMarkdown));

  if (fingerprint && hasStrongFallback) {
    return {
      stableId: `fingerprint:${fingerprint}`,
      identityKind: "fingerprint",
      confidence: "medium",
      fingerprint,
    };
  }

  return {
    stableId: "",
    identityKind: "missing",
    confidence: "low",
    fingerprint,
  };
}

function canonicalSummaryText(markdown) {
  return String(markdown || "")
    .replace(/^\ufeff/, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Join multiple summary exports into one bundle for stable-id / hash input.
 *
 * @param {Array<{ markdown?: string }> | null | undefined} summaries
 * @returns {string}
 */
export function buildSummaryBundle(summaries) {
  if (!Array.isArray(summaries) || summaries.length === 0) return "";
  return summaries
    .map((summary) => String(summary?.markdown || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export async function hashSummary(markdown) {
  const text = canonicalSummaryText(markdown);
  if (!text) return "";

  const cryptoImpl = globalThis.crypto?.subtle;
  const encoder = globalThis.TextEncoder ? new TextEncoder() : null;
  if (cryptoImpl && encoder) {
    const digest = await cryptoImpl.digest("SHA-256", encoder.encode(text));
    const bytes = Array.from(new Uint8Array(digest));
    return `sha256:${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  return `fnv1a:${hashStringSync(text)}`;
}

function sameIfPresent(previous, next) {
  if (!previous && !next) return true;
  if (!previous || !next) return false;
  return previous === next;
}

function hasChanged(previous, next) {
  if (!next) return false;
  if (!previous) return true;
  return previous !== next;
}

export function determineSyncAction(existingRecord, candidate) {
  if (!candidate?.stableId || candidate.identityConfidence === "low") {
    return {
      action: SYNC_ACTION_SKIPPED,
      status: SYNC_STATUS_SKIPPED,
      downloadRequired: false,
      metadataOnly: false,
      reason: "identity_unreliable",
    };
  }

  if (!existingRecord) {
    return {
      action: SYNC_ACTION_NEW,
      status: SYNC_STATUS_SUCCESS,
      downloadRequired: true,
      metadataOnly: false,
      reason: "new_record",
    };
  }

  const summaryChanged = hasChanged(
    existingRecord.summaryHash,
    candidate.summaryHash
  );
  const audioChanged = hasChanged(
    existingRecord.audioSignature,
    candidate.audioSignature
  );
  const missingSummaryWasAdded =
    !existingRecord.summaryHash && !!candidate.summaryHash;
  const missingAudioWasAdded =
    !existingRecord.audioSignature && !!candidate.audioSignature;

  if (
    summaryChanged ||
    audioChanged ||
    missingSummaryWasAdded ||
    missingAudioWasAdded
  ) {
    return {
      action: SYNC_ACTION_UPDATED,
      status: SYNC_STATUS_UPDATED,
      downloadRequired: true,
      metadataOnly: false,
      reason: "content_changed",
    };
  }

  const titleChanged =
    cleanString(existingRecord.title) !== cleanString(candidate.title);
  const desiredFilenameChanged =
    cleanString(existingRecord.normalizedFilename) !==
      cleanString(candidate.normalizedFilename) ||
    cleanString(existingRecord.audioNormalizedFilename) !==
      cleanString(candidate.audioNormalizedFilename);
  const folderChanged =
    cleanString(existingRecord.folderSegment) !==
    cleanString(candidate.folderSegment);

  if (
    titleChanged ||
    desiredFilenameChanged ||
    folderChanged ||
    !sameIfPresent(existingRecord.sourceUrl, candidate.sourceUrl)
  ) {
    return {
      action: SYNC_ACTION_UPDATED,
      status: SYNC_STATUS_UPDATED,
      downloadRequired: false,
      metadataOnly: true,
      reason: "metadata_changed",
    };
  }

  return {
    action: SYNC_ACTION_ALREADY_SYNCED,
    status: SYNC_STATUS_ALREADY_SYNCED,
    downloadRequired: false,
    metadataOnly: false,
    reason: "already_synced",
  };
}

/**
 * Adjusts an `already_synced` action when the vault file is missing or the
 * planned path differs from the index. Caller supplies disk facts (no I/O here).
 * Extension smart sync passes `summaryMissingOnDisk: false` (no vault access).
 *
 * @param {ReturnType<typeof determineSyncAction>} action
 * @param {Record<string, any> | null | undefined} existingRecord
 * @param {{ plannedSummaryPath?: string, summaryMissingOnDisk?: boolean }} [options]
 * @returns {ReturnType<typeof determineSyncAction>}
 */
export function refineSyncActionForDisk(action, existingRecord, options = {}) {
  const plannedSummaryPath = String(options.plannedSummaryPath || "");
  const summaryMissingOnDisk = !!options.summaryMissingOnDisk;

  if (action.action !== SYNC_ACTION_ALREADY_SYNCED || !existingRecord) {
    return action;
  }

  if (summaryMissingOnDisk) {
    return {
      action: SYNC_ACTION_UPDATED,
      status: SYNC_STATUS_UPDATED,
      downloadRequired: true,
      metadataOnly: false,
      reason: "summary_file_missing",
    };
  }

  const existingPath = String(existingRecord.summaryPath || "");
  const planned = String(plannedSummaryPath || "");
  if (existingPath && planned && existingPath !== planned) {
    return {
      action: SYNC_ACTION_UPDATED,
      status: SYNC_STATUS_UPDATED,
      downloadRequired: false,
      metadataOnly: true,
      reason: "path_changed",
    };
  }

  return action;
}

export function detectDuplicate(syncIndex, candidate) {
  if (!syncIndex?.records || !candidate?.stableId) return null;
  const direct = syncIndex.records[candidate.stableId];
  if (direct) {
    return { stableId: candidate.stableId, record: direct, match: "stableId" };
  }
  if (!candidate.fingerprint) return null;
  for (const [stableId, record] of Object.entries(syncIndex.records)) {
    if (record?.fingerprint && record.fingerprint === candidate.fingerprint) {
      return { stableId, record, match: "fingerprint" };
    }
  }
  return null;
}

export function updateExistingRecord(existingRecord, candidate, patch = {}) {
  const now = patch.lastSyncedAt || new Date().toISOString();
  return {
    ...(existingRecord || {}),
    stableId: candidate.stableId,
    identityKind: candidate.identityKind,
    identityConfidence: candidate.identityConfidence,
    fingerprint: candidate.fingerprint || existingRecord?.fingerprint || "",
    title: candidate.title || existingRecord?.title || "",
    normalizedFilename:
      candidate.normalizedFilename || existingRecord?.normalizedFilename || "",
    audioNormalizedFilename:
      candidate.audioNormalizedFilename ||
      existingRecord?.audioNormalizedFilename ||
      "",
    sourceUrl: candidate.sourceUrl || existingRecord?.sourceUrl || "",
    audioUrl: candidate.audioUrl || existingRecord?.audioUrl || "",
    summaryHash: candidate.summaryHash || existingRecord?.summaryHash || "",
    audioSignature:
      candidate.audioSignature || existingRecord?.audioSignature || "",
    createdAt: candidate.createdAt || existingRecord?.createdAt || "",
    updatedAt: candidate.updatedAt || existingRecord?.updatedAt || "",
    lastSyncedAt: now,
    status: patch.status || candidate.status || SYNC_STATUS_SUCCESS,
    summaryPath: patch.summaryPath || existingRecord?.summaryPath || "",
    audioPath: patch.audioPath || existingRecord?.audioPath || "",
    folderSegment:
      patch.folderSegment ||
      candidate.folderSegment ||
      existingRecord?.folderSegment ||
      "",
    lastDownloadIds:
      patch.lastDownloadIds || existingRecord?.lastDownloadIds || [],
  };
}

export function createEmptySyncIndex() {
  return {
    v: 1,
    records: {},
    settings: {
      storageMode: "downloads_subfolder",
      syncSubdirectory: DEFAULT_SYNC_SUBDIRECTORY,
      syncNotificationsEnabled: true,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeSyncIndex(value) {
  const base = createEmptySyncIndex();
  if (!value || typeof value !== "object") return base;
  return {
    ...base,
    ...value,
    records:
      value.records &&
      typeof value.records === "object" &&
      !Array.isArray(value.records)
        ? value.records
        : {},
    settings: {
      ...base.settings,
      ...(value.settings && typeof value.settings === "object"
        ? value.settings
        : {}),
    },
  };
}

/** @param {{ syncNotificationsEnabled?: boolean } | null | undefined} settings */
export function resolveSyncNotificationsEnabled(settings) {
  return settings?.syncNotificationsEnabled !== false;
}

export function sanitizeSyncSubdirectory(value) {
  const raw = String(value || "").trim();
  const safeParts = raw
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => sanitizePathSegment(part, { fallback: "" }))
    .filter(Boolean);
  if (!safeParts.length) return DEFAULT_SYNC_SUBDIRECTORY;
  return safeParts.join("/");
}

/**
 * Downloads-relative path: `{syncSubdir}/{Plaud folder}/Audio|Summaries/{filename}`.
 * `folderSegment` mirrors Plaud sidebar groups (Unfiled, Trash, user folders).
 *
 * @param {string} subdirectory
 * @param {"audio"|"summary"} artifactType
 * @param {string} filename
 * @param {string} [folderSegment]
 */
export function buildRelativeArtifactPath(
  subdirectory,
  artifactType,
  filename,
  folderSegment = ""
) {
  const folder = sanitizeSyncSubdirectory(subdirectory);
  const segment = String(folderSegment || "").trim()
    ? sanitizePathSegment(folderSegment, {
        fallback: "Folder",
        maxLength: 80,
      })
    : "";
  const kind = artifactType === "audio" ? "Audio" : "Summaries";
  const safeName = sanitizePathSegment(filename, {
    fallback: artifactType === "audio" ? "Plaud audio" : "Plaud summary",
    maxLength: 160,
  });
  const parts = [folder];
  if (segment) parts.push(segment);
  parts.push(kind, safeName);
  return parts.join("/");
}
