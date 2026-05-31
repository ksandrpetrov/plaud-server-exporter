/**
 * Plaud recording timestamp fields vary by endpoint (snake_case vs camelCase).
 * Single source for sync runner and live tree read model.
 *
 * Policy: pass `getRecordingCreatedAtRaw` into `buildStableId` (sync + live tree).
 * Use `getRecordingCreatedAtIso` only for display fields such as `lastSyncedAt`.
 */

import { getRawField } from "../../../plaud-exporter/common/syncCore.js";

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

/**
 * @param {object | null | undefined} raw
 * @returns {string}
 */
export function getRecordingCreatedAtRaw(raw) {
  return getRawField(raw, RECORDING_CREATED_AT_KEYS);
}

/**
 * @param {object | null | undefined} raw
 * @returns {string}
 */
export function getRecordingUpdatedAtRaw(raw) {
  return getRawField(raw, RECORDING_UPDATED_AT_KEYS);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function toIsoFromAny(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const direct = new Date(String(value));
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return "";
}

/**
 * @param {object | null | undefined} raw
 * @returns {string}
 */
export function getRecordingCreatedAtIso(raw) {
  const value = getRecordingCreatedAtRaw(raw);
  return value ? toIsoFromAny(value) : "";
}
