import assert from "node:assert/strict";
import test from "node:test";
import {
  clipRichMarkdown,
  isRichMessageUnavailable,
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

test("clipRichMarkdown trims without newline when boundary is too early", () => {
  const text = "a".repeat(RICH_MARKDOWN_MAX_LEN + 100);
  const clipped = clipRichMarkdown(text);
  assert.ok(clipped.length <= RICH_MARKDOWN_MAX_LEN);
  assert.ok(!clipped.includes("\n"));
});

test("isRichMessageUnavailable detects missing API markers", () => {
  assert.ok(
    isRichMessageUnavailable(new Error("sendRichMessage: method not found"))
  );
  assert.ok(isRichMessageUnavailable(new Error("rich_message is invalid")));
  assert.equal(isRichMessageUnavailable(new Error("network timeout")), false);
});
