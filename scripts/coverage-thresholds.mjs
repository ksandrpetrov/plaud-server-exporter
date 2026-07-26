#!/usr/bin/env node
/**
 * Parses an lcov.info file and fails the process when aggregate coverage drops
 * below configured thresholds. Designed for `node --test --experimental-test-coverage`.
 *
 * Usage:
 *   node scripts/coverage-thresholds.mjs <lcov-file> <thresholds-json>
 *
 * Thresholds JSON shapes:
 *   {
 *     "include": "server/src/",   // substring filter for record SF: paths
 *     "lines": 85,                 // minimum line %
 *     "branches": 60,              // minimum branch %
 *     "functions": 80              // minimum function %
 *   }
 * or:
 *   {
 *     "requiredFiles": ["content/contentHandlers.js"],
 *     "scopes": [
 *       {
 *         "name": "critical workflows",
 *         "include": ["content/", "background/chromeDownloadBridge.js"],
 *         "lines": 75,
 *         "branches": 65,
 *         "functions": 70
 *       }
 *     ]
 *   }
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , lcovArg, thresholdsArg] = process.argv;

if (!lcovArg || !thresholdsArg) {
  console.error(
    "usage: coverage-thresholds.mjs <lcov-file> <thresholds-json-or-inline>"
  );
  process.exit(2);
}

const lcovPath = resolve(lcovArg);
if (!existsSync(lcovPath)) {
  console.error(`coverage-thresholds: lcov file not found: ${lcovPath}`);
  process.exit(2);
}

let thresholds;
try {
  thresholds = existsSync(thresholdsArg)
    ? JSON.parse(readFileSync(thresholdsArg, "utf8"))
    : JSON.parse(thresholdsArg);
} catch (err) {
  console.error(`coverage-thresholds: invalid thresholds JSON: ${err.message}`);
  process.exit(2);
}

const text = readFileSync(lcovPath, "utf8");
const coverageKeys = ["LF", "LH", "BRF", "BRH", "FNF", "FNH"];
const records = [];
let currentRecord = null;

for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    currentRecord = {
      path: line.slice(3),
      totals: { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 },
    };
    continue;
  }
  if (!currentRecord) continue;
  if (line === "end_of_record") {
    records.push(currentRecord);
    currentRecord = null;
    continue;
  }
  const separator = line.indexOf(":");
  if (separator < 0) continue;
  const key = line.slice(0, separator);
  if (!coverageKeys.includes(key)) continue;
  currentRecord.totals[key] += Number(line.slice(separator + 1)) || 0;
}

function pct(hit, found) {
  if (!found) return 100;
  return (hit / found) * 100;
}

const fmt = (n) => `${n.toFixed(2)}%`;

const failures = [];

for (const requiredFile of thresholds.requiredFiles ?? []) {
  if (!records.some((record) => record.path.includes(requiredFile))) {
    failures.push(`required file absent from LCOV: ${requiredFile}`);
  }
}

const scopes = Array.isArray(thresholds.scopes)
  ? thresholds.scopes
  : [thresholds];

for (const [index, scope] of scopes.entries()) {
  const includes = Array.isArray(scope.include)
    ? scope.include.map(String)
    : [String(scope.include ?? "")];
  const selected = records.filter(
    (record) =>
      includes.includes("") ||
      includes.some((include) => record.path.includes(include))
  );
  const totals = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
  for (const record of selected) {
    for (const key of coverageKeys) totals[key] += record.totals[key];
  }

  const linePct = pct(totals.LH, totals.LF);
  const branchPct = pct(totals.BRH, totals.BRF);
  const functionPct = pct(totals.FNH, totals.FNF);
  const minLines = Number(scope.lines ?? 0);
  const minBranches = Number(scope.branches ?? 0);
  const minFunctions = Number(scope.functions ?? 0);
  const filter = includes.filter(Boolean).join(", ") || "(all files)";
  const name = String(scope.name || `scope ${index + 1}`);

  console.log(`coverage-thresholds: ${name} scope='${filter}' from ${lcovArg}`);
  console.log(
    `  lines    : ${fmt(linePct)} (${totals.LH}/${totals.LF}), min ${minLines}%`
  );
  console.log(
    `  branches : ${fmt(branchPct)} (${totals.BRH}/${totals.BRF}), min ${minBranches}%`
  );
  console.log(
    `  functions: ${fmt(functionPct)} (${totals.FNH}/${totals.FNF}), min ${minFunctions}%`
  );

  if (!selected.length) {
    failures.push(`${name}: no LCOV records matched`);
  }
  if (linePct + 1e-9 < minLines) {
    failures.push(`${name}: lines ${fmt(linePct)} < ${minLines}%`);
  }
  if (branchPct + 1e-9 < minBranches) {
    failures.push(`${name}: branches ${fmt(branchPct)} < ${minBranches}%`);
  }
  if (functionPct + 1e-9 < minFunctions) {
    failures.push(`${name}: functions ${fmt(functionPct)} < ${minFunctions}%`);
  }
}

if (failures.length) {
  console.error(`coverage-thresholds: FAIL — ${failures.join("; ")}`);
  process.exit(1);
}

console.log("coverage-thresholds: OK");
