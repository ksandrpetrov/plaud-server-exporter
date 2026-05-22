import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_SUBDIRECTORY,
  EXPORT_MODE_BOTH,
  extractTitleFromMarkdown,
  normalizeFilename,
  normalizeExportMode,
  sanitizeDownloadFilename,
  sanitizeDownloadSegment,
  sanitizePathSegment,
  UTF8_BOM,
  withUtf8Bom,
} from "../common/exportPathUtils.js";

test("withUtf8Bom prepends BOM once for UTF-8 mobile viewers", () => {
  assert.equal(withUtf8Bom("Обслуживание"), `${UTF8_BOM}Обслуживание`);
  assert.equal(withUtf8Bom(`${UTF8_BOM}already`), `${UTF8_BOM}already`);
});

test("normalizeExportMode keeps valid modes and defaults unknown to both", () => {
  assert.equal(normalizeExportMode("audio"), "audio");
  assert.equal(normalizeExportMode("summary"), "summary");
  assert.equal(normalizeExportMode("both"), "both");
  assert.equal(normalizeExportMode(""), EXPORT_MODE_BOTH);
  assert.equal(normalizeExportMode(undefined), EXPORT_MODE_BOTH);
  assert.equal(normalizeExportMode("invalid"), EXPORT_MODE_BOTH);
});

test("sanitizeDownloadSegment strips risky characters", () => {
  assert.equal(sanitizeDownloadSegment('evil:name*'), "evil - name");
  assert.equal(sanitizeDownloadSegment("  x  "), "x");
});

test("sanitizeDownloadFilename joins safe segments and has audio fallback", () => {
  assert.ok(
    sanitizeDownloadFilename("PlaudExports/Audio/foo.mp3").endsWith("foo.mp3")
  );
  assert.equal(
    sanitizeDownloadFilename(""),
    `${AUDIO_SUBDIRECTORY}/plaud-audio.audio.mp3`
  );
});

test("extractTitleFromMarkdown reads the first heading and removes markup", () => {
  assert.equal(
    extractTitleFromMarkdown("\n\n# **Моя тема** `Q2`\n\nBody"),
    "Моя тема Q2"
  );
  assert.equal(extractTitleFromMarkdown("Plain title\nbody"), "Plain title");
});

test("extractTitleFromMarkdown skips leading Plaud boilerplate headings", () => {
  assert.equal(
    extractTitleFromMarkdown(
      "# Plaud Web\n\n# Обсуждение рабочих процессов и статуса задач в команде\n\nBody"
    ),
    "Обсуждение рабочих процессов и статуса задач в команде"
  );
  assert.equal(extractTitleFromMarkdown("# Plaud Web\n\nТолько бренд."), "");
});

test("normalizeFilename creates readable cross-platform markdown names", () => {
  assert.equal(
    normalizeFilename("# Моя длинная тема: итоги встречи / Q2?", {
      extension: ".md",
    }),
    "Моя длинная тема - итоги встречи - Q2.md"
  );
  assert.equal(
    sanitizePathSegment('CON: bad <name>|'),
    "CON - bad - name"
  );
  assert.ok(
    normalizeFilename("x".repeat(220), {
      extension: ".md",
      maxBaseLength: 80,
    }).length <= 83
  );
});
