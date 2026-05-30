#!/usr/bin/env node
/**
 * Parses an lcov.info file and fails the process when aggregate coverage drops
 * below configured thresholds. Designed for `node --test --experimental-test-coverage`.
 *
 * Usage:
 *   node scripts/coverage-thresholds.mjs <lcov-file> <thresholds-json>
 *
 * Thresholds JSON shape:
 *   {
 *     "include": "server/src/",   // substring filter for record SF: paths
 *     "lines": 85,                 // minimum line %
 *     "branches": 60,              // minimum branch %
 *     "functions": 80              // minimum function %
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

const include = String(thresholds.include ?? "");
const minLines = Number(thresholds.lines ?? 0);
const minBranches = Number(thresholds.branches ?? 0);
const minFunctions = Number(thresholds.functions ?? 0);

const text = readFileSync(lcovPath, "utf8");

let inRecord = false;
let keepRecord = false;
let totals = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };

for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    inRecord = true;
    const sf = line.slice(3);
    keepRecord = include === "" || sf.includes(include);
    continue;
  }
  if (!inRecord || !keepRecord) {
    if (line === "end_of_record") {
      inRecord = false;
      keepRecord = false;
    }
    continue;
  }
  if (line === "end_of_record") {
    inRecord = false;
    keepRecord = false;
    continue;
  }
  const [key, value] = line.split(":");
  if (!key || value === undefined) continue;
  if (key in totals) {
    totals[key] += Number(value) || 0;
  }
}

function pct(hit, found) {
  if (!found) return 100;
  return (hit / found) * 100;
}

const linePct = pct(totals.LH, totals.LF);
const branchPct = pct(totals.BRH, totals.BRF);
const functionPct = pct(totals.FNH, totals.FNF);

const filter = include || "(all files)";
const fmt = (n) => `${n.toFixed(2)}%`;

console.log(`coverage-thresholds: scope='${filter}' from ${lcovArg}`);
console.log(
  `  lines    : ${fmt(linePct)} (${totals.LH}/${totals.LF}), min ${minLines}%`
);
console.log(
  `  branches : ${fmt(branchPct)} (${totals.BRH}/${totals.BRF}), min ${minBranches}%`
);
console.log(
  `  functions: ${fmt(functionPct)} (${totals.FNH}/${totals.FNF}), min ${minFunctions}%`
);

const failures = [];
if (linePct + 1e-9 < minLines)
  failures.push(`lines ${fmt(linePct)} < ${minLines}%`);
if (branchPct + 1e-9 < minBranches)
  failures.push(`branches ${fmt(branchPct)} < ${minBranches}%`);
if (functionPct + 1e-9 < minFunctions)
  failures.push(`functions ${fmt(functionPct)} < ${minFunctions}%`);

if (failures.length) {
  console.error(`coverage-thresholds: FAIL — ${failures.join("; ")}`);
  process.exit(1);
}

console.log("coverage-thresholds: OK");
