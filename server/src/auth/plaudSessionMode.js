import { config } from "../config/config.js";

/**
 * @typedef {"oauth" | "snapshot"} AuthMode
 * @typedef {"official" | "web"} ApiMode
 */

/**
 * @param {{ authMode?: string }} [session]
 * @returns {ApiMode}
 */
export function resolveApiMode(session) {
  const configured = config.apiMode;
  if (configured === "official") {
    return "official";
  }
  if (session?.authMode === "oauth") {
    // OAuth access tokens target the Developer API, not web /file/simple/web.
    return "official";
  }
  if (configured === "web") {
    return "web";
  }
  return "web";
}

/**
 * Apply resolved apiMode onto a session object (mutates copy).
 *
 * @param {object} session
 * @returns {object}
 */
export function withResolvedApiMode(session) {
  return {
    ...session,
    apiMode: resolveApiMode(session),
  };
}

/**
 * @returns {AuthMode | "auto"}
 */
export function configuredAuthMode() {
  return config.authMode;
}
