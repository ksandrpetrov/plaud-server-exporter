import { mkdir, writeFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config, effectiveVaultRoot } from "../config/config.js";
import {
  normalizeFilename,
  withUtf8Bom,
} from "../../../plaud-exporter/common/exportPathUtils.js";
import { resolveMeetingTitle } from "./filenamePlanner.js";

/**
 * @deprecated Summary-only server exporter; not wired into `runSync`.
 *   Kept for path-planning tests only. See `syncAudioDefault.test.js`.
 */
export function planAudioPath({ title, extension, folderSegment = "" }) {
  const vault = effectiveVaultRoot();
  const plaudRoot = resolve(vault, config.obsidianSubfolder || "Plaud");
  const withFolder = folderSegment ? join(plaudRoot, folderSegment) : plaudRoot;
  const baseDir = join(withFolder, "_attachments");
  const ext = (extension || "mp3").replace(/^\./, "");
  const filename = normalizeFilename(title || "plaud-audio", {
    extension: `.${ext}`,
    fallbackBase: "plaud-audio",
    maxBaseLength: 132,
  });
  const absolutePath = join(baseDir, filename);
  const relativePath = absolutePath
    .substring(vault.length)
    .replace(/^[/\\]+/, "");
  return { absolutePath, relativePath, filename };
}

function stripDuplicateLeadingTitle(markdown, title) {
  const text = String(markdown || "")
    .replace(/^\ufeff/, "")
    .trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const first = lines[0] || "";
  const headingMatch = /^\s{0,3}#{1,6}\s+(.+)$/.exec(first);
  if (headingMatch) {
    const h = headingMatch[1].replace(/[`*_~]+/g, "").trim();
    if (title && h.toLowerCase() === String(title).trim().toLowerCase()) {
      return lines.slice(1).join("\n").trimStart();
    }
  }
  return text;
}

/**
 * Builds clean Markdown: meeting summary only, no exporter frontmatter.
 */
export function buildMarkdownDocument({ file, summaries, candidate }) {
  const title = resolveMeetingTitle({
    plaudTitle: file?.title,
    summaries,
    createdAt: candidate?.createdAt,
  });

  const bodySections = (summaries || [])
    .map((s) => stripDuplicateLeadingTitle(s?.markdown || "", title))
    .map((s) => String(s).trim())
    .filter(Boolean);

  if (!bodySections.length) {
    return `# ${title}\n\n_(No summary content returned by Plaud.)_\n`;
  }

  return `${bodySections.join("\n\n---\n\n")}\n`;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
}

export async function writeMarkdownFile({
  absolutePath,
  contents,
  previousAbsolutePath = "",
}) {
  await mkdir(dirname(absolutePath), { recursive: true });

  if (
    previousAbsolutePath &&
    previousAbsolutePath !== absolutePath &&
    (await pathExists(previousAbsolutePath))
  ) {
    try {
      if (!(await pathExists(absolutePath))) {
        await rename(previousAbsolutePath, absolutePath);
      } else {
        await unlink(previousAbsolutePath);
      }
    } catch {
      // Best-effort rename; fall back to writing the new path.
    }
  }

  const tmpPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, withUtf8Bom(contents), "utf8");
  await rename(tmpPath, absolutePath);
}

/**
 * @deprecated Summary-only server exporter; not wired into `runSync`.
 *   See `server/tests/syncAudioDefault.test.js`.
 */
export async function writeAudioFile({ absolutePath, url }) {
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");

  await mkdir(dirname(absolutePath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Audio download failed: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Audio download returned no body");
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(absolutePath)
  );
}
