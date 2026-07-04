#!/usr/bin/env node
/**
 * Validates browser-extension/manifest.json invariants:
 *   - manifest_version === 3
 *   - version is SemVer-compatible (Chrome accepts "x", "x.y", "x.y.z", "x.y.z.w")
 *   - referenced files (background, popup, content scripts, icons, locales, WAR)
 *     all exist on disk
 *   - default_locale has a matching _locales/<locale>/messages.json
 *   - permissions and host_permissions do not contain forbidden wildcards that
 *     would either fail Chrome Web Store review or accidentally over-grant
 *
 * Run as part of `npm run verify` (extension) so regressions surface in CI.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(HERE, "..");
const MANIFEST_PATH = join(EXTENSION_ROOT, "manifest.json");

const FORBIDDEN_PERMISSIONS = new Set([
  "<all_urls>",
  "debugger",
  "experimental",
  "history",
  "privacy",
  "proxy",
  "system.cpu",
  "system.memory",
  "system.storage",
  "vpnProvider",
]);

/** @type {string[]} */
const errors = [];

function fail(msg) {
  errors.push(msg);
}

function fileExists(rel) {
  const abs = join(EXTENSION_ROOT, rel);
  return existsSync(abs) && statSync(abs).isFile();
}

function dirExists(rel) {
  const abs = join(EXTENSION_ROOT, rel);
  return existsSync(abs) && statSync(abs).isDirectory();
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (err) {
  console.error(`verify-manifest: cannot read manifest.json: ${err.message}`);
  process.exit(2);
}

// 1) manifest_version
if (manifest.manifest_version !== 3) {
  fail(
    `manifest_version must be 3 (MV3); got ${JSON.stringify(manifest.manifest_version)}`
  );
}

// 2) version — Chrome SemVer subset (1..4 dot-separated unsigned integers, 0-65535 each).
const versionRe = /^(\d{1,5})(\.\d{1,5}){0,3}$/;
const version = String(manifest.version || "");
if (!versionRe.test(version)) {
  fail(
    `version must be Chrome SemVer (e.g. "1", "1.0", "1.0.0"); got "${version}"`
  );
} else {
  for (const part of version.split(".")) {
    if (Number(part) > 65535) {
      fail(`version segment exceeds Chrome limit (65535): "${part}"`);
    }
  }
}

// 3) default_locale + _locales/<locale>/messages.json
if (manifest.default_locale) {
  const localePath = `_locales/${manifest.default_locale}/messages.json`;
  if (!fileExists(localePath)) {
    fail(
      `default_locale "${manifest.default_locale}" but ${localePath} is missing`
    );
  }
}

// 4) background.service_worker exists.
const sw = manifest.background?.service_worker;
if (typeof sw === "string") {
  if (!fileExists(sw)) fail(`background.service_worker missing on disk: ${sw}`);
} else {
  fail("background.service_worker must be a string (MV3)");
}

// 5) action.default_popup exists.
const popup = manifest.action?.default_popup;
if (popup && !fileExists(popup)) {
  fail(`action.default_popup missing on disk: ${popup}`);
}

// 6) icons referenced in action.default_icon and top-level icons.
const iconBuckets = [manifest.icons, manifest.action?.default_icon];
for (const bucket of iconBuckets) {
  if (!bucket) continue;
  for (const [size, rel] of Object.entries(bucket)) {
    if (!fileExists(String(rel))) {
      fail(`icon ${size}px missing on disk: ${rel}`);
    }
  }
}

// 7) content_scripts js files exist.
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) {
    if (!fileExists(js)) fail(`content_scripts js missing on disk: ${js}`);
  }
}

// 8) web_accessible_resources: parent directory must exist (glob is allowed).
for (const war of manifest.web_accessible_resources || []) {
  for (const resource of war.resources || []) {
    const dir = resource.includes("*")
      ? resource.replace(/\/?\*.*$/, "")
      : resource;
    if (dir && !dirExists(dir) && !fileExists(resource)) {
      fail(`web_accessible_resources points to missing path: ${resource}`);
    }
  }
}

// 9) Forbidden permissions / wildcards.
for (const perm of manifest.permissions || []) {
  if (FORBIDDEN_PERMISSIONS.has(perm)) {
    fail(`forbidden permission "${perm}" (security/review risk)`);
  }
}
for (const host of manifest.host_permissions || []) {
  if (host === "<all_urls>" || host === "*://*/*") {
    fail(`host_permissions wildcard "${host}" forbidden; scope to plaud.ai`);
  }
}

if (errors.length) {
  console.error("verify-manifest: FAIL");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `verify-manifest: OK (MV${manifest.manifest_version}, v${version})`
);
