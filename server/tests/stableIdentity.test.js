import assert from "node:assert/strict";
import test from "node:test";

const {
  buildSyncStableIdentity,
  buildLiveTreeStableIdentity,
  buildErrorRecordStableIdentity,
} = await import("../src/sync/stableIdentity.js");

const file = {
  id: "abcdef0123456789abcdef0123456789",
  title: "Weekly sync",
  raw: {
    file_id: "abcdef0123456789abcdef0123456789",
    file_name: "Weekly sync",
    created_at: "2026-05-17T10:00:00.000Z",
  },
};

const summaries = [{ markdown: "Discussed roadmap", type: "summary" }];

test("buildSyncStableIdentity and buildLiveTreeStableIdentity share plaud id for same file", () => {
  const syncIdentity = buildSyncStableIdentity(file, { summaries });
  const liveIdentity = buildLiveTreeStableIdentity(file);
  assert.equal(syncIdentity.stableId, liveIdentity.stableId);
  assert.match(syncIdentity.stableId, /^plaud:[a-f0-9]{32}$/);
});

test("buildErrorRecordStableIdentity matches live tree plaud id", () => {
  const liveIdentity = buildLiveTreeStableIdentity(file);
  const errorIdentity = buildErrorRecordStableIdentity(file);
  assert.equal(errorIdentity.stableId, liveIdentity.stableId);
});

test("buildSyncStableIdentity uses normalized meeting title", () => {
  const identity = buildSyncStableIdentity(file, {
    summaries,
    meetingTitle: "Normalized title",
  });
  assert.equal(identity.stableId, buildLiveTreeStableIdentity(file).stableId);
});
