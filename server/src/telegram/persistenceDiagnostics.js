/**
 * Startup diagnostics for bot persistence (Docker volume / systemd migration).
 */

import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/config.js";
import { logger } from "../logger.js";
import { loadOwnerChat } from "./ownerChat.js";
import { loadSessionSnapshot } from "../auth/sessionStore.js";

const STATE_FILES = [
  "session.json",
  "sync-index.json",
  "status.json",
  "owner-chat.json",
  "bot-settings.json",
  "telegram-offset.json",
  "tree-browse.json",
];

/**
 * @param {string} dir
 * @returns {Promise<{ files: string[]; fingerprint: string }>}
 */
async function dataDirFingerprint(dir) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { files: [], fingerprint: "empty" };
    }
    throw err;
  }

  const jsonFiles = entries.filter((n) => n.endsWith(".json")).sort();
  const parts = [];
  for (const name of jsonFiles) {
    try {
      const st = await stat(join(dir, name));
      parts.push(`${name}:${st.size}:${st.mtimeMs}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  const fingerprint = parts.length
    ? createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)
    : "empty";
  return { files: jsonFiles, fingerprint };
}

/**
 * @param {string} dir
 * @returns {Promise<number>}
 */
async function countBackupSnapshots(dir) {
  try {
    const entries = await readdir(dir);
    return entries.filter((n) => n.includes(".bak")).length;
  } catch (err) {
    if (err && err.code === "ENOENT") return 0;
    throw err;
  }
}

/**
 * Logs persistence state at bot startup (helps catch empty Docker volumes after migration).
 */
export async function logPersistenceDiagnostics() {
  const dataDir = config.botDataDir;
  const { files, fingerprint } = await dataDirFingerprint(dataDir);
  const owner = await loadOwnerChat();
  const session = await loadSessionSnapshot();
  const backups = await countBackupSnapshots(dataDir);

  const present = STATE_FILES.filter((f) => files.includes(f));
  const empty = present.length === 0;

  logger.info("Persistence loaded", {
    dataDir,
    jsonFiles: files.length,
    stateFiles: present.length,
    ownerChat: owner ? "yes" : "no",
    session: session ? "yes" : "no",
    stateFingerprint: fingerprint,
  });

  if (empty && backups > 0) {
    logger.warn(
      "Persistence is empty but backup files exist in server/.data — " +
        "typical after systemd→Docker without migrate-legacy-data.sh. " +
        "Run scripts/migrate-legacy-data.sh on the server before deploy."
    );
  }

  if (owner && !session) {
    logger.warn(
      "Owner chat is configured but Plaud session.json is missing — sync will fail until session is copied from Mac."
    );
  }
}
