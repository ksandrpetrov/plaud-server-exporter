/**
 * Normalized shape for `status.json` fields shared by reader and writer.
 */

/**
 * @param {string | { message: string, at?: string } | null | undefined} value
 * @returns {{ message: string, at: string } | null}
 */
export function normalizeLastAuthError(value) {
  if (!value) return null;
  if (typeof value === "object" && value.message) {
    return {
      message: String(value.message).slice(0, 500),
      at: value.at || new Date().toISOString(),
    };
  }
  return {
    message: String(value).slice(0, 500),
    at: new Date().toISOString(),
  };
}
