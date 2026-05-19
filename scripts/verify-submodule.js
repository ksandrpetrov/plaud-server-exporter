#!/usr/bin/env node
/**
 * Verifies that shared `plaud-exporter/common/*` files exist and that all
 * server-side imports into plaud-exporter resolve. Run via `npm run verify`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");

const REQUIRED_SUBMODULE_FILES = [
  "plaud-exporter/common/syncCore.js",
  "plaud-exporter/common/exportPathUtils.js",
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
  console.error(`verify-submodule: ${message}`);
  process.exitCode = 1;
}

function checkRequiredFiles() {
  let ok = true;
  for (const rel of REQUIRED_SUBMODULE_FILES) {
    const full = resolve(root, rel);
    if (!existsSync(full)) {
      fail(`missing required plaud-exporter file: ${rel}`);
      ok = false;
    }
  }
  return ok;
}

const IMPORT_RE = /from\s+["']([^"']+)["']/g;

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

if (filesOk && importsOk) {
  console.log("verify-submodule: OK");
}
