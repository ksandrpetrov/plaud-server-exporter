#!/usr/bin/env node
// Run ESLint from inside a workspace directory so it discovers the local flat
// config and resolves plugins from the workspace's `node_modules`. Used by
// `.lintstagedrc.mjs` because lint-staged (via tinyexec) does not spawn a
// shell, so `cd <ws> && eslint ...` cannot be used — and on macOS the
// `/usr/bin/cd` wrapper would otherwise swallow the rest of the command and
// silently no-op, hiding ESLint failures.
//
// Usage: node scripts/lint-staged-eslint.mjs <workspace-dir> <files...>

import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import process from "node:process";

const [, , workspaceArg, ...filesArgs] = process.argv;

if (!workspaceArg || filesArgs.length === 0) {
  console.error("Usage: lint-staged-eslint.mjs <workspace-dir> <files...>");
  process.exit(2);
}

const ROOT = process.cwd();
const workspaceAbs = path.resolve(ROOT, workspaceArg);

const eslintLocal = path.resolve(workspaceAbs, "node_modules/.bin/eslint");
const eslintHoisted = path.resolve(ROOT, "node_modules/.bin/eslint");

const eslintBin = existsSync(eslintLocal)
  ? eslintLocal
  : existsSync(eslintHoisted)
    ? eslintHoisted
    : null;

if (!eslintBin) {
  console.error(
    `lint-staged-eslint: could not find eslint binary for workspace "${workspaceArg}". ` +
      "Run `npm install` to provision dependencies."
  );
  process.exit(1);
}

const relFiles = filesArgs.map((f) =>
  path.relative(workspaceAbs, path.resolve(ROOT, f))
);

const child = spawn(eslintBin, ["--max-warnings", "0", "--fix", ...relFiles], {
  cwd: workspaceAbs,
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error(`lint-staged-eslint: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
