import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withUtf8Bom } from "../../../browser-extension/common/exportPathUtils.js";
import { resolveMeetingTitle } from "./filenamePlanner.js";

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
