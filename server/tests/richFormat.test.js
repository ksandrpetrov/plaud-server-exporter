import assert from "node:assert/strict";
import test from "node:test";
import { isRichMessageUnavailable } from "../src/telegram/apiFallback.js";
import {
  clipRichMarkdown,
  RICH_MARKDOWN_MAX_LEN,
  splitRichMarkdown,
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

test("splitRichMarkdown prefers paragraph boundaries", () => {
  const chunks = splitRichMarkdown(
    "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
    40
  );
  assert.deepEqual(chunks, [
    "First paragraph.\n\nSecond paragraph.",
    "Third paragraph.",
  ]);
});

test("splitRichMarkdown keeps fenced code and tables intact when they fit", () => {
  const code = "```js\nconst answer = 42;\n```";
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const chunks = splitRichMarkdown(`${code}\n\n${table}`, 40);
  assert.deepEqual(chunks, [code, table]);
});

test("splitRichMarkdown hard-splits one oversized line", () => {
  const text = "x".repeat(25);
  const chunks = splitRichMarkdown(text, 10);
  assert.deepEqual(chunks, ["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  assert.ok(chunks.every((chunk) => chunk.length <= 10));
});

test("isRichMessageUnavailable detects missing API markers", () => {
  assert.ok(
    isRichMessageUnavailable(new Error("sendRichMessage: method not found"))
  );
  assert.ok(isRichMessageUnavailable(new Error("rich_message is invalid")));
  assert.equal(isRichMessageUnavailable(new Error("network timeout")), false);
});
