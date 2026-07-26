import assert from "node:assert/strict";
import test from "node:test";

import { processSmartSyncFile } from "../features/audioExport/extensionSyncExecutor.js";

const file = {
  id: "abcdef0123456789abcdef0123456789",
  title: "Architecture review",
  raw: { file_id: "abcdef0123456789abcdef0123456789" },
  folderSegment: "Work",
};

const session = {
  apiBase: "https://api.plaud.ai",
  authHeader: "Bearer test",
  userAuthHeader: "Bearer test",
  workspaceAuthHeader: "",
  workspaceId: "workspace-test",
  sortBy: "start_time",
};

function makeStats() {
  return {
    status: "running",
    total: 1,
    processed: 0,
    new: 0,
    updated: 0,
    skipped: 0,
    alreadySynced: 0,
    errors: 0,
    audioDownloaded: 0,
    summariesDownloaded: 0,
    startedAt: Date.now(),
    finishedAt: null,
    currentTitle: "",
    lastMessage: "",
  };
}

function makeCandidate(patch = {}) {
  return {
    stableId: `plaud:${file.id}`,
    identityKind: "plaud_id",
    identityConfidence: "high",
    fingerprint: "fingerprint-1",
    title: file.title,
    sourceUrl: "https://web.plaud.ai",
    summaryHash: "summary-hash",
    audioSignature: "audio-signature",
    normalizedFilename: "Architecture review.md",
    audioNormalizedFilename: "Architecture review.audio.mp3",
    createdAt: "",
    updatedAt: "",
    folderSegment: file.folderSegment,
    ...patch,
  };
}

function makeIndex(record = null) {
  const records = {};
  if (record) records[record.stableId] = record;
  return {
    v: 1,
    records,
    settings: {},
    updatedAt: new Date(0).toISOString(),
  };
}

function makeDeps({ candidate, summaries = [], failCandidate = false } = {}) {
  const calls = { saves: 0, audio: [], summaries: [] };
  return {
    calls,
    deps: {
      saveSyncIndex: async (index) => {
        calls.saves++;
        return index;
      },
      buildSyncCandidate: async () => {
        if (failCandidate) throw new Error("candidate failed");
        return candidate || makeCandidate();
      },
      fetchPlaudSummaryExports: async () => summaries,
      fetchPlaudAudioUrl: async () => ({
        url: "https://cdn.example.test/review.mp3",
        titleHint: file.title,
      }),
      downloadViaBackground: async (url, filename) => {
        calls.audio.push({ url, filename });
        return { success: true, downloadId: 11, filename };
      },
      downloadTextViaBackground: async (content, filename) => {
        calls.summaries.push({ content, filename });
        return { success: true, downloadId: 12, filename };
      },
    },
  };
}

async function runCase({
  candidate,
  existing,
  summaries,
  audio,
  failCandidate,
}) {
  const stats = makeStats();
  const syncIndex = makeIndex(existing);
  const progress = [];
  const harness = makeDeps({ candidate, summaries, failCandidate });
  await processSmartSyncFile({
    session,
    file: { ...file, folderSegment: candidate?.folderSegment || "Work" },
    syncIndex,
    stats,
    progress: (patch = {}) => progress.push(patch),
    requestedSubdir: "PlaudExports/Sync",
    shouldDownloadAudio: audio === true,
    sourceUrl: "https://web.plaud.ai",
    _deps: harness.deps,
  });
  return { stats, syncIndex, progress, ...harness };
}

test("processSmartSyncFile handles new audio and summary downloads", async () => {
  const candidate = makeCandidate();
  const result = await runCase({
    candidate,
    summaries: [{ title: file.title, markdown: "# Architecture review\nBody" }],
    audio: true,
  });

  assert.equal(result.stats.new, 1);
  assert.equal(result.stats.processed, 1);
  assert.equal(result.stats.audioDownloaded, 1);
  assert.equal(result.stats.summariesDownloaded, 1);
  assert.equal(result.calls.audio.length, 1);
  assert.equal(result.calls.summaries.length, 1);
  assert.equal(result.syncIndex.records[candidate.stableId].status, "success");
});

test("processSmartSyncFile skips unchanged records", async () => {
  const candidate = makeCandidate({ summaryHash: "", audioSignature: "" });
  const existing = { ...candidate, status: "success" };
  const result = await runCase({ candidate, existing });

  assert.equal(result.stats.alreadySynced, 1);
  assert.equal(result.stats.skipped, 1);
  assert.equal(result.stats.processed, 1);
  assert.equal(result.calls.audio.length, 0);
  assert.equal(result.calls.summaries.length, 0);
});

test("processSmartSyncFile applies metadata-only updates without downloads", async () => {
  const candidate = makeCandidate({
    title: "Renamed architecture review",
    summaryHash: "",
    audioSignature: "",
  });
  const existing = {
    ...candidate,
    title: "Old title",
    normalizedFilename: candidate.normalizedFilename,
  };
  const result = await runCase({ candidate, existing });

  assert.equal(result.stats.updated, 1);
  assert.equal(result.stats.processed, 1);
  assert.equal(result.calls.audio.length, 0);
  assert.equal(result.calls.summaries.length, 0);
});

test("processSmartSyncFile relocates folder artifacts", async () => {
  const candidate = makeCandidate({ folderSegment: "New folder" });
  const existing = {
    ...candidate,
    folderSegment: "Old folder",
    summaryPath: "PlaudExports/Sync/Old folder/Summary/Old.md",
    summaryPaths: ["PlaudExports/Sync/Old folder/Summary/Old.md"],
  };
  const result = await runCase({
    candidate,
    existing,
    summaries: [{ title: file.title, markdown: "# Architecture review\nBody" }],
  });

  assert.equal(result.stats.updated, 1);
  assert.equal(result.calls.summaries.length, 1);
  assert.match(
    result.syncIndex.records[candidate.stableId].summaryPath,
    /New folder/
  );
});

test("processSmartSyncFile records a per-file error and continues", async () => {
  const result = await runCase({ failCandidate: true });

  assert.equal(result.stats.errors, 1);
  assert.equal(result.stats.processed, 1);
  const record = result.syncIndex.records[`plaud:${file.id}`];
  assert.equal(record.status, "error");
  assert.match(record.lastError, /candidate failed/);
  assert.ok(result.calls.saves >= 1);
});
