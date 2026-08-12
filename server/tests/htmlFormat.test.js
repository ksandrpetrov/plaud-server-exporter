import assert from "node:assert/strict";
import test from "node:test";
import { isHtmlEntitiesRejected } from "../src/telegram/apiFallback.js";
import {
  blockquote,
  expandableBlockquote,
  stripExpandableBlockquote,
  stripUnsupportedHtml,
} from "../src/telegram/htmlFormat.js";

test("blockquote wraps text", () => {
  assert.equal(blockquote("hello"), "<blockquote>hello</blockquote>");
});

test("expandableBlockquote wraps when enough lines", () => {
  const body = "a\nb\nc";
  assert.equal(
    expandableBlockquote(body, { threshold: 3 }),
    "<blockquote>a\nb\nc</blockquote>"
  );
});

test("expandableBlockquote skips short text", () => {
  assert.equal(expandableBlockquote("one line", { threshold: 3 }), "one line");
});

test("stripExpandableBlockquote normalizes legacy attribute", () => {
  const raw = '<blockquote expandable="true">x</blockquote>';
  assert.equal(stripExpandableBlockquote(raw), "<blockquote>x</blockquote>");
});

test("isHtmlEntitiesRejected detects parse errors", () => {
  assert.equal(
    isHtmlEntitiesRejected(new Error("Bad Request: can't parse entities")),
    true
  );
  assert.equal(isHtmlEntitiesRejected(new Error("network")), false);
});

test("BOT_HELP_HTML contains blockquote via messages module", async () => {
  const { BOT_HELP_HTML } = await import("../src/telegram/messages.js");
  assert.match(BOT_HELP_HTML, /<blockquote>/);
});

test("stripUnsupportedHtml is stable on plain HTML", () => {
  const html = "<b>ok</b>";
  assert.equal(stripUnsupportedHtml(html), html);
});
