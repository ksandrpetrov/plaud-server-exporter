/**
 * Drift guard: ensures every classic-script call site that pre-dates the
 * `runtimeMessages.js` ES module (popup.js, content.js) still references the same wire strings.
 *
 * Background.js and audioExport.js import from the registry directly; if
 * those drift, normal lint/tests catch it. This file specifically protects
 * the files that are loaded as plain scripts and can't `import` constants.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { RUNTIME_MESSAGE_ACTIONS } from "../common/runtimeMessages.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CLASSIC_SCRIPT_FILES = [
  "popup/popup.js",
  "popup/popupTabs.js",
  "popup/popupMessaging.js",
  "popup/popupSyncUi.js",
  "popup/popupStatsUi.js",
  "popup/popupExportUi.js",
  "content.js",
];

/**
 * Actions that classic scripts are allowed NOT to reference. (They're sent or
 * received only by the ES-module side: background.js / audioExport.js.)
 */
const ACTIONS_NOT_USED_BY_CLASSIC_SCRIPTS = new Set([
  "ACTION_DOWNLOAD_PLAUD_FILE",
  "ACTION_EXPORT_PROGRESS_UPDATE",
]);

test("every registry action either appears in a classic-script file or is allow-listed", () => {
  const corpus = CLASSIC_SCRIPT_FILES.map((rel) =>
    readFileSync(resolve(root, rel), "utf8")
  ).join("\n");

  for (const [name, value] of Object.entries(RUNTIME_MESSAGE_ACTIONS)) {
    if (ACTIONS_NOT_USED_BY_CLASSIC_SCRIPTS.has(name)) continue;
    const needle = `"${value}"`;
    assert.ok(
      corpus.includes(needle),
      `runtimeMessages: classic scripts no longer reference ${name} (value ${needle}). ` +
        `Either add the literal back or update ACTIONS_NOT_USED_BY_CLASSIC_SCRIPTS.`
    );
  }
});

test("classic-script action: literals all correspond to a known registry key", () => {
  const knownValues = new Set(Object.values(RUNTIME_MESSAGE_ACTIONS));
  const re = /action\s*:\s*"([^"]+)"|action\s*===\s*"([^"]+)"/g;
  for (const rel of CLASSIC_SCRIPT_FILES) {
    const text = readFileSync(resolve(root, rel), "utf8");
    let match;
    while ((match = re.exec(text)) !== null) {
      const value = match[1] || match[2];
      assert.ok(
        knownValues.has(value),
        `${rel}: action literal "${value}" is not in RUNTIME_MESSAGE_ACTIONS. ` +
          "Add it to common/runtimeMessages.js so renames stay safe."
      );
    }
  }
});
