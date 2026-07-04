import { basename } from "node:path";

const DATED_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\.md$/i;

/**
 * @param {string} pathOrName
 * @returns {{ date: string; title: string; year: string } | null}
 */
export function parseSummaryFilename(pathOrName) {
  const name = basename(String(pathOrName || ""));
  const match = DATED_FILENAME_RE.exec(name);
  if (!match) return null;
  const date = match[1];
  const title = match[2].trim() || name;
  return { date, title, year: date.slice(0, 4) };
}

/**
 * @param {string} isoLike
 * @returns {string}
 */
export function dateFromIso(isoLike) {
  if (!isoLike) return "";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
