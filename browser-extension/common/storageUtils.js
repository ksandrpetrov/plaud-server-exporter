import {
  createEmptySyncIndex,
  normalizeSyncIndex,
  SYNC_INDEX_STORAGE_KEY,
} from "./syncCore.js";

function ensureStorageArea(area = "local") {
  const storageArea = chrome?.storage?.[area];
  if (!storageArea) {
    throw new Error(`chrome.storage.${area} недоступен.`);
  }
  return storageArea;
}

export function storageGet(keys, area = "local") {
  return new Promise((resolve, reject) => {
    ensureStorageArea(area).get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result || {});
    });
  });
}

export function storageSet(values, area = "local") {
  return new Promise((resolve, reject) => {
    ensureStorageArea(area).set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(undefined);
    });
  });
}

export function storageRemove(keys, area = "local") {
  return new Promise((resolve, reject) => {
    ensureStorageArea(area).remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(undefined);
    });
  });
}

export async function loadSyncIndex() {
  const result = await storageGet([SYNC_INDEX_STORAGE_KEY], "local");
  return normalizeSyncIndex(result[SYNC_INDEX_STORAGE_KEY]);
}

export async function saveSyncIndex(syncIndex) {
  const normalized = normalizeSyncIndex(syncIndex || createEmptySyncIndex());
  normalized.updatedAt = new Date().toISOString();
  await storageSet({ [SYNC_INDEX_STORAGE_KEY]: normalized }, "local");
  return normalized;
}

export async function patchSyncSettings(settingsPatch) {
  const index = await loadSyncIndex();
  index.settings = {
    ...index.settings,
    ...(settingsPatch && typeof settingsPatch === "object"
      ? settingsPatch
      : {}),
  };
  return saveSyncIndex(index);
}
