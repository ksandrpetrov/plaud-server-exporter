import assert from "node:assert/strict";
import test from "node:test";
import {
  findSummaryNotes,
  getNoteInlineContent,
  getSummaryNoteTitle,
  parseSummaryContent,
  stripPlaudInlineAssets,
  SUMMARY_NOTE_TYPES,
} from "../common/plaudSummaries.js";

test("SUMMARY_NOTE_TYPES includes Plaud summary note kinds", () => {
  assert.ok(SUMMARY_NOTE_TYPES.has("summary"));
  assert.ok(SUMMARY_NOTE_TYPES.has("auto_sum_note"));
  assert.ok(SUMMARY_NOTE_TYPES.has("sum_multi_note"));
});

test("findSummaryNotes reads direct data arrays", () => {
  const notes = findSummaryNotes({
    data: [{ data_type: "summary", data_content: "Hello" }],
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].data_content, "Hello");
});

test("findSummaryNotes walks nested payloads", () => {
  const notes = findSummaryNotes({
    status: 0,
    wrapper: {
      inner: [{ note_type: "auto_sum_note", data_content: "Nested" }],
    },
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].data_content, "Nested");
});

test("parseSummaryContent unwraps JSON strings and object sections", () => {
  assert.equal(parseSummaryContent('{"summary":"Body"}'), "Body");
  assert.match(parseSummaryContent({ intro: "Line one" }), /## intro/);
  assert.equal(parseSummaryContent(["A", "B"]), "A\n\nB");
});

test("getNoteInlineContent prefers data_content over data_link", () => {
  assert.equal(
    getNoteInlineContent({ data_content: "inline", data_link: "https://x" }),
    "inline"
  );
  assert.equal(getNoteInlineContent({ data_link: "https://x" }), "");
});

test("getSummaryNoteTitle falls back to default", () => {
  assert.equal(getSummaryNoteTitle({ data_title: "Meet" }), "Meet");
  assert.equal(getSummaryNoteTitle({}, "Саммари"), "Саммари");
});

test("stripPlaudInlineAssets removes broken summary_poster image refs", () => {
  const input = [
    "# Meeting",
    "",
    "Some intro paragraph.",
    "",
    "![PLAUD NOTE](permanent/a903bb32899d44cebfb0ad290d1f7964/mem_clCuOCRS93/summary_poster/card_20260515123824-v2@ec0991016d3ae673c11b7a_20260515124016_dfaf005d.png)",
    "",
    "Body continues.",
    "Inline ![card](cdn.plaud.ai/summary_poster/abc.png) reference too.",
    "",
    "![keep me](https://example.com/figure.png)",
  ].join("\n");
  const out = stripPlaudInlineAssets(input);
  assert.doesNotMatch(out, /summary_poster/);
  assert.doesNotMatch(out, /permanent\//);
  assert.doesNotMatch(out, /PLAUD NOTE/);
  assert.match(out, /Body continues\./);
  assert.match(out, /Inline {2}reference too\./);
  assert.match(out, /!\[keep me\]\(https:\/\/example\.com\/figure\.png\)/);
  assert.doesNotMatch(out, /\n{3,}/);
});
