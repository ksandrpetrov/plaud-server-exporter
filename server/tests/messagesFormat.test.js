import assert from "node:assert/strict";
import test from "node:test";
import {
  clipTelegramText,
  describeStatusVerdict,
  safeSliceHtml,
  TELEGRAM_HTML_MAX_LEN,
} from "../src/telegram/messages/format.js";
import {
  syncProgressHtml,
  syncProgressRichMarkdown,
  syncSummaryRichMarkdown,
  statusScreenHtml,
} from "../src/telegram/messages/sync.js";
import { clipRichMarkdown } from "../src/telegram/richFormat.js";

test("safeSliceHtml closes open tags and never cuts inside a tag", () => {
  const text = "<b>Hello <i>world</i> friend</b>";
  const sliced = safeSliceHtml(text, 16);
  assert.ok(sliced.endsWith("</i></b>"), `unexpected slice: ${sliced}`);
  assert.ok(!sliced.match(/<[a-z]*$/), `slice has dangling tag: ${sliced}`);
});

test("safeSliceHtml retreats before an entity if needed", () => {
  const text = "hello&amp;world";
  const sliced = safeSliceHtml(text, 8);
  assert.equal(sliced, "hello");
});

test("clipTelegramText keeps HTML balanced under TELEGRAM_HTML_MAX_LEN", () => {
  const long = "<b>" + "a".repeat(5000) + "</b>";
  const clipped = clipTelegramText(long);
  assert.ok(clipped.length <= TELEGRAM_HTML_MAX_LEN);
  assert.equal(
    (clipped.match(/<b>/g) || []).length,
    (clipped.match(/<\/b>/g) || []).length
  );
});

test("describeStatusVerdict uses friendly Russian labels", () => {
  assert.equal(describeStatusVerdict("completed"), "успешно");
  assert.equal(describeStatusVerdict("running"), "идёт");
});

test("syncProgressRichMarkdown includes percent, checklist, and lastMessage", () => {
  const md = syncProgressRichMarkdown({
    processed: 42,
    total: 128,
    lastMessage: "Synced: Встреча с командой QA",
  });
  assert.match(md, /\*\*42 \/ 128\*\* \(33%\)/);
  assert.match(md, /- \[x\] Список записей/);
  assert.match(md, /> Synced: Встреча с командой QA/);
});

test("syncProgressHtml wraps lastMessage in a blockquote", () => {
  const html = syncProgressHtml({
    processed: 5,
    total: 10,
    lastMessage: "Synced: Demo",
  });
  assert.match(html, /50%/);
  assert.match(html, /<blockquote>Synced: Demo<\/blockquote>/);
});

test("syncSummaryRichMarkdown keeps metrics in the table only", () => {
  const md = syncSummaryRichMarkdown(
    { new: 0, updated: 0, unchanged: 0, skipped: 2, errors: 1 },
    { source: "manual", durationSec: 12 }
  );
  assert.match(md, /\| Пропущено \| 2 \|/);
  assert.match(md, /\| Ошибок \| 1 \|/);
  assert.doesNotMatch(md, /<details open>/);
});

test("clipRichMarkdown preserves table and details blocks", () => {
  const md = clipRichMarkdown(
    "# Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<details><summary>S</summary>\n\nBody\n\n</details>"
  );
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /<details>/);
});

test("statusScreenHtml clips long lastAuthError under TELEGRAM_HTML_MAX_LEN", () => {
  const html = statusScreenHtml({
    lastSyncAt: "2026-05-01T12:00:00.000Z",
    lastSyncStats: {
      status: "completed",
      new: 0,
      updated: 0,
      unchanged: 1,
      skipped: 0,
      errors: 0,
    },
    lastAuthError: {
      message: "x".repeat(5000),
      at: "2026-05-01T11:00:00.000Z",
    },
  });
  assert.ok(html.length <= TELEGRAM_HTML_MAX_LEN);
});
