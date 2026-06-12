import assert from "node:assert/strict";
import test from "node:test";
import {
  clipTelegramText,
  safeSliceHtml,
  TELEGRAM_HTML_MAX_LEN,
} from "../src/telegram/messages/format.js";

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
