import assert from "node:assert/strict";
import test from "node:test";
import {
  clipRichMarkdown,
  isRichMessageUnavailable,
  prepareSummaryRichMarkdown,
  RICH_MARKDOWN_MAX_LEN,
  stripUtf8Bom,
} from "../src/telegram/richFormat.js";

test("stripUtf8Bom removes leading BOM", () => {
  assert.equal(stripUtf8Bom("\uFEFF# Title"), "# Title");
  assert.equal(stripUtf8Bom("# no bom"), "# no bom");
});

test("clipRichMarkdown clips under max length", () => {
  const long = "line\n".repeat(RICH_MARKDOWN_MAX_LEN);
  const clipped = clipRichMarkdown(long);
  assert.ok(clipped.length <= RICH_MARKDOWN_MAX_LEN);
});

test("prepareSummaryRichMarkdown adds title heading and strips BOM", () => {
  const md = prepareSummaryRichMarkdown({
    markdown: "\uFEFF## Section\n\nBody",
    title: "Meeting notes",
  });
  assert.match(md, /^# Meeting notes/);
  assert.match(md, /## Section/);
});

test("isRichMessageUnavailable detects missing API markers", () => {
  assert.ok(
    isRichMessageUnavailable(new Error("sendRichMessage: method not found"))
  );
  assert.ok(isRichMessageUnavailable(new Error("rich_message is invalid")));
  assert.equal(isRichMessageUnavailable(new Error("network timeout")), false);
});
