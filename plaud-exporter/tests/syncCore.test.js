import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAudioSignature,
  buildRelativeArtifactPath,
  buildStableId,
  determineSyncAction,
  getRawField,
  hashSummary,
  sanitizeSyncSubdirectory,
  SYNC_ACTION_ALREADY_SYNCED,
  SYNC_ACTION_NEW,
  SYNC_ACTION_SKIPPED,
  SYNC_ACTION_UPDATED,
} from "../common/syncCore.js";

test("buildStableId prefers Plaud ids over filename-like fields", () => {
  const id = "abcdef0123456789abcdef0123456789";
  const result = buildStableId({
    file_id: id,
    title: "Renamed summary",
    summaryMarkdown: "# Title\nBody",
  });
  assert.equal(result.stableId, `plaud:${id}`);
  assert.equal(result.confidence, "high");
});

test("buildStableId falls back to a medium-confidence fingerprint", () => {
  const result = buildStableId({
    sourceUrl: "https://web.plaud.ai/file/current?x=1",
    audioUrl: "https://api.plaud.ai/audio/object.mp3?signature=temp",
    title: "Meeting",
    summaryMarkdown: "# Meeting\nNotes",
  });
  assert.match(result.stableId, /^fingerprint:/);
  assert.equal(result.confidence, "medium");
});

test("hashSummary is stable across trailing whitespace and CRLF", async () => {
  const a = await hashSummary("# Title\r\nText  \r\n");
  const b = await hashSummary("# Title\nText");
  assert.equal(a, b);
  assert.match(a, /^(sha256|fnv1a):/);
});

test("determineSyncAction handles new, unchanged, rename-only and content updates", () => {
  const candidate = {
    stableId: "plaud:abc",
    identityConfidence: "high",
    title: "New title",
    normalizedFilename: "New title.md",
    audioNormalizedFilename: "New title.audio.mp3",
    sourceUrl: "https://web.plaud.ai/file/abc",
    summaryHash: "sha256:1",
    audioSignature: "audio-meta:1",
  };

  assert.equal(determineSyncAction(null, candidate).action, SYNC_ACTION_NEW);

  const existing = {
    ...candidate,
    title: "Old title",
    normalizedFilename: "Old title.md",
  };
  const renamed = determineSyncAction(existing, candidate);
  assert.equal(renamed.action, SYNC_ACTION_UPDATED);
  assert.equal(renamed.metadataOnly, true);
  assert.equal(renamed.downloadRequired, false);

  const unchanged = determineSyncAction(candidate, candidate);
  assert.equal(unchanged.action, SYNC_ACTION_ALREADY_SYNCED);

  const changed = determineSyncAction(candidate, {
    ...candidate,
    summaryHash: "sha256:2",
  });
  assert.equal(changed.action, SYNC_ACTION_UPDATED);
  assert.equal(changed.downloadRequired, true);
});

test("determineSyncAction relocates when folderSegment changes", () => {
  const candidate = {
    stableId: "plaud:abc",
    identityConfidence: "high",
    title: "Meeting",
    normalizedFilename: "2026-05-17 - Meeting.md",
    audioNormalizedFilename: "",
    sourceUrl: "",
    summaryHash: "sha256:1",
    audioSignature: "",
    folderSegment: "Unfiled",
  };
  const existing = {
    ...candidate,
    folderSegment: "",
  };
  const action = determineSyncAction(existing, candidate);
  assert.equal(action.action, SYNC_ACTION_UPDATED);
  assert.equal(action.metadataOnly, true);
});

test("determineSyncAction skips unreliable identity", () => {
  assert.equal(
    determineSyncAction(null, {
      stableId: "",
      identityConfidence: "low",
    }).action,
    SYNC_ACTION_SKIPPED
  );
});

test("buildRelativeArtifactPath nests Unfiled under sync Audio and Summaries", () => {
  const audio = buildRelativeArtifactPath(
    "PlaudExports/Sync",
    "audio",
    "meeting.audio.mp3",
    "Unfiled"
  );
  const summary = buildRelativeArtifactPath(
    "PlaudExports/Sync",
    "summary",
    "Meeting.md",
    "Unfiled"
  );
  assert.match(audio, /PlaudExports\/Sync\/Unfiled\/Audio\//);
  assert.match(summary, /PlaudExports\/Sync\/Unfiled\/Summaries\//);
});

test("sanitizeSyncSubdirectory keeps sync inside Downloads-relative folders", () => {
  assert.equal(
    sanitizeSyncSubdirectory("../Plaud:Sync//Q2?"),
    "Plaud - Sync/Q2"
  );
  assert.equal(sanitizeSyncSubdirectory(""), "PlaudExports/Sync");
});

test("getRawField returns first non-empty trimmed value", () => {
  const raw = { size: "", file_size: "  42  ", bytes: 100 };
  assert.equal(getRawField(raw, ["size", "file_size", "bytes"]), "42");
  assert.equal(getRawField(raw, ["missing", "bytes"]), "100");
  assert.equal(getRawField(null, ["any"]), "");
  assert.equal(getRawField({}, ["any"]), "");
});

test("buildAudioSignature is stable across snake_case and camelCase keys", () => {
  const a = buildAudioSignature({
    id: "abc",
    raw: {
      file_size: 1234,
      duration_ms: 42,
      created_at: "2026-05-17T10:00:00Z",
      updated_at: "2026-05-17T10:05:00Z",
      md5: "deadbeef",
    },
  });
  const b = buildAudioSignature({
    id: "abc",
    raw: {
      fileSize: 1234,
      durationMs: 42,
      createdAt: "2026-05-17T10:00:00Z",
      updatedAt: "2026-05-17T10:05:00Z",
      md5: "deadbeef",
    },
  });
  assert.match(a, /^audio-meta:[0-9a-f]{8}$/);
  assert.equal(a, b);
});

test("buildAudioSignature changes when id or size changes", () => {
  const base = buildAudioSignature({ id: "abc", raw: { size: 100 } });
  const otherId = buildAudioSignature({ id: "xyz", raw: { size: 100 } });
  const otherSize = buildAudioSignature({ id: "abc", raw: { size: 200 } });
  assert.notEqual(base, otherId);
  assert.notEqual(base, otherSize);
});
