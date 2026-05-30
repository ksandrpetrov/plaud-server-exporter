// Lint-staged runs from the repo root, but ESLint configs live inside each
// workspace (`server/eslint.config.js`, `plaud-exporter/eslint.config.js`).
// Dispatch staged files to ESLint per workspace via a small Node helper so the
// command runs with the workspace as cwd (where its flat config + plugins
// live). We can't use `cd <ws> && eslint …` because lint-staged uses tinyexec
// (no shell), and on macOS `/usr/bin/cd` would silently no-op, hiding lint
// failures entirely.
//
// Files outside both workspaces (e.g. `scripts/*.mjs`, repo-root configs) are
// formatted with Prettier only — no ESLint rules apply to them today.

import path from "node:path";

const ROOT = process.cwd();
const HELPER = "scripts/lint-staged-eslint.mjs";

const quote = (p) => `"${p.replace(/(["\\$`])/g, "\\$1")}"`;
const join = (xs) => xs.map(quote).join(" ");

const filesIn = (files, dir) => {
  const abs = path.resolve(ROOT, dir);
  return files.filter((f) => {
    const a = path.resolve(ROOT, f);
    return a === abs || a.startsWith(abs + path.sep);
  });
};

const eslintForWorkspace = (files, dir) =>
  `node ${quote(HELPER)} ${quote(dir)} ${join(files)}`;

export default {
  "*.{js,mjs}": (files) => {
    const tasks = [`prettier --write ${join(files)}`];

    const serverFiles = filesIn(files, "server");
    if (serverFiles.length > 0) {
      tasks.push(eslintForWorkspace(serverFiles, "server"));
    }

    const extensionFiles = filesIn(files, "plaud-exporter");
    if (extensionFiles.length > 0) {
      tasks.push(eslintForWorkspace(extensionFiles, "plaud-exporter"));
    }

    return tasks;
  },
  "*.{json,md,yml,yaml}": "prettier --write",
  "plaud-exporter/manifest.json":
    "node plaud-exporter/scripts/verify-manifest.js",
  ".github/workflows/*.{yml,yaml}": "prettier --write",
};
