#!/usr/bin/env node
/**
 * Non-blocking LOC report for large JS files (>500 lines).
 * Usage: node scripts/loc-report.mjs
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const THRESHOLD = 500;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".data",
  "dist",
  "coverage",
]);

/**
 * @param {string} dir
 * @returns {Promise<Array<{ path: string; lines: number }>>}
 */
async function walkJs(dir) {
  /** @type {Array<{ path: string; lines: number }>} */
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkJs(full)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const text = await readFile(full, "utf8");
    out.push({
      path: relative(ROOT, full),
      lines: text.split("\n").length,
    });
  }
  return out;
}

async function main() {
  const targets = [
    join(ROOT, "server", "src"),
    join(ROOT, "browser-extension"),
    join(ROOT, "scripts"),
  ];
  /** @type {Array<{ path: string; lines: number }>} */
  const files = [];
  for (const dir of targets) {
    try {
      await stat(dir);
      files.push(...(await walkJs(dir)));
    } catch {
      // skip missing dirs
    }
  }

  const large = files
    .filter((f) => f.lines > THRESHOLD)
    .sort((a, b) => b.lines - a.lines);

  if (!large.length) {
    console.log(`No JS files above ${THRESHOLD} LOC.`);
    return;
  }

  console.log(`JS files above ${THRESHOLD} LOC:`);
  for (const file of large) {
    console.log(`  ${file.lines}\t${file.path}`);
  }
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
