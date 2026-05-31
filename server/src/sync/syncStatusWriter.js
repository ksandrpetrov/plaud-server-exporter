import { config } from "../config/config.js";
import { readJsonSafe, writeJsonAtomic } from "../util/atomicJson.js";
import { normalizeLastAuthError } from "./statusSchema.js";

export { normalizeLastAuthError } from "./statusSchema.js";

/**
 * @param {{ stats?: object | null, lastAuthError?: string | { message: string, at?: string } | null }} [params]
 */
export async function writeStatusFile({ stats, lastAuthError } = {}) {
  const payload = {
    lastSyncAt:
      /** @type {{finishedAt?: string}} */ (stats || {}).finishedAt || null,
    lastSyncStats: stats || null,
    lastAuthError: normalizeLastAuthError(lastAuthError),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(config.statusPath, payload);
}

export async function recordAuthError(message) {
  const existing =
    (await readJsonSafe(config.statusPath, {
      fallback: {},
      label: "status.json",
    })) || {};
  const payload = {
    ...existing,
    lastAuthError: normalizeLastAuthError(message),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(config.statusPath, payload);
}
