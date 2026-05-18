#!/usr/bin/env node
/**
 * Ensures dynamic import / injection paths reference real files (MV3 regression guard).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readUtf8(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function fileExists(rel) {
  try {
    fs.accessSync(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

function globDirHasJs(dirRel) {
  try {
    const names = fs.readdirSync(path.join(root, dirRel));
    return names.some((n) => n.endsWith(".js"));
  } catch {
    return false;
  }
}

const errors = [];

function checkPath(rel) {
  const normalized = rel.replace(/^\.\//, "");
  if (normalized.includes("*")) {
    const dir = path.dirname(normalized);
    if (!globDirHasJs(dir)) {
      errors.push(`No .js files in glob directory: ${normalized}`);
    }
    return;
  }
  if (!fileExists(normalized)) {
    errors.push(`Missing file: ${normalized}`);
  }
}

const contentJs = readUtf8("content.js");
const getUrlRe = /chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/g;
let m;
while ((m = getUrlRe.exec(contentJs)) !== null) {
  checkPath(m[1]);
}

const bgJs = readUtf8("background.js");
const execRe = /files:\s*\[\s*["']([^"']+)["']\s*\]/g;
while ((m = execRe.exec(bgJs)) !== null) {
  checkPath(m[1]);
}

const bgImportRe = /import\s+["'](\.[^"']+\.js)["']/g;
while ((m = bgImportRe.exec(bgJs)) !== null) {
  checkPath(m[1]);
}

const popupJs = readUtf8("popup/popup.js");
while ((m = execRe.exec(popupJs)) !== null) {
  checkPath(m[1]);
}

if (errors.length) {
  console.error("verify-extension-imports failed:\n", errors.join("\n"));
  process.exit(1);
}

console.log("verify-extension-imports: OK");
