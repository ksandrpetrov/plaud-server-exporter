#!/usr/bin/env node
/**
 * Verifies that shared `browser-extension/common/*` files exist and that all
 * server-side imports into browser-extension resolve. Run via `npm run verify`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");

const SHARED_CONTRACT_FILES = [
  "browser-extension/common/syncCore.js",
  "browser-extension/common/exportPathUtils.js",
  "browser-extension/common/plaudFolders.js",
  "browser-extension/common/plaudRecordingIds.js",
  "browser-extension/common/plaudTitles.js",
  "browser-extension/common/plaudSummaries.js",
  "browser-extension/common/plaudRecordings.js",
];

const SERVER_SRC = resolve(root, "server/src");

async function walkJsFiles(dir) {
  const result = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkJsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      result.push(full);
    }
  }
  return result;
}

function fail(message) {
  console.error(`verify-shared-contract: ${message}`);
  process.exitCode = 1;
}

function checkRequiredFiles() {
  let ok = true;
  for (const rel of SHARED_CONTRACT_FILES) {
    const full = resolve(root, rel);
    if (!existsSync(full)) {
      fail(`missing required shared contract file: ${rel}`);
      ok = false;
    }
  }
  return ok;
}

const IMPORT_RE = /(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g;
const SHARED_COMMON_PREFIX = "browser-extension/common/";

function sharedCommonBasenames() {
  return new Set(
    SHARED_CONTRACT_FILES.map((rel) => rel.slice(SHARED_COMMON_PREFIX.length))
  );
}

async function walkAndCheckCommonImports(dir, allowed) {
  const files = await walkJsFiles(dir);
  let ok = true;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1];
      const marker = "browser-extension/common/";
      const idx = spec.indexOf(marker);
      if (idx === -1) continue;
      const basename = spec.slice(idx + marker.length);
      if (!allowed.has(basename)) {
        fail(
          `server imports extension-only common module: ${spec} (in ${file})`
        );
        ok = false;
      }
    }
  }
  return ok;
}

async function checkServerImports() {
  if (!existsSync(SERVER_SRC)) return true;
  const files = await walkJsFiles(SERVER_SRC);
  let ok = true;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec);
      const candidates = [target, `${target}.js`, join(target, "index.js")];
      if (!candidates.some(existsSync)) {
        fail(`broken import in ${file}: ${spec}`);
        ok = false;
      }
    }
  }
  return ok;
}

const filesOk = checkRequiredFiles();
const importsOk = await checkServerImports();
const commonBoundaryOk = await walkAndCheckCommonImports(
  SERVER_SRC,
  sharedCommonBasenames()
);

if (filesOk && importsOk && commonBoundaryOk) {
  console.log("verify-shared-contract: OK");
}
