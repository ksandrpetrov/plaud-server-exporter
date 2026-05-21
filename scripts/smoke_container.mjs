#!/usr/bin/env node
/**
 * In-container smoke: resolve critical server modules and shared common imports.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");

const modules = [
  "server/src/config/config.js",
  "server/src/http/webServer.js",
  "server/src/telegram/index.js",
  "server/src/sync/syncRunner.js",
  "plaud-exporter/common/syncCore.js",
  "plaud-exporter/common/exportPathUtils.js",
  "plaud-exporter/common/plaudFolders.js",
];

for (const rel of modules) {
  await import(pathToFileURL(join(appRoot, rel)).href);
}

const require = createRequire(import.meta.url);
const pkgPath = join(appRoot, "server", "package.json");
const pkg = require(pkgPath);
if (!pkg.dependencies?.dotenv) {
  throw new Error("dotenv dependency missing in production image");
}

console.log("smoke_container: imports OK");
