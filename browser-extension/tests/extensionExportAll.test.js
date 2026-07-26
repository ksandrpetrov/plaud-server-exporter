import assert from "node:assert/strict";
import test from "node:test";

import { runExportAll } from "../features/audioExport/extensionExportAll.js";

const recording = {
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

function makeHarness({ failSession = false, failList = false } = {}) {
  const calls = {
    audio: [],
    summaries: [],
    indicators: [],
    removed: 0,
  };
  const indicator = {
    remove() {
      calls.removed++;
    },
  };
  const deps = {
    createStatusIndicator: () => indicator,
    updateIndicator: (_indicator, message, type = "info") => {
      calls.indicators.push({ message, type });
    },
    scheduleIndicatorRemoval: (callback) => callback(),
    getPlaudSession: async () => {
      if (failSession) throw new Error("session unavailable");
      return session;
    },
    fetchPlaudFilesFromApi: async () => {
      if (failList) throw new Error("list unavailable");
      return [{ ...recording, raw: { ...recording.raw } }];
    },
    mergeDomRecordingIdsIntoFiles: () => ({ domMerged: 0, domSeen: 0 }),
    mergeLocalStorageRecordingIdsIntoFiles: () => ({
      lsMerged: 0,
      lsSeen: 0,
      lsFromLocal: 0,
      ssFromSession: 0,
    }),
    fetchPlaudAudioUrl: async () => ({
      url: "https://cdn.example.test/review.mp3",
      titleHint: "Architecture review",
    }),
    tryFetchRecordingTitleHint: async () => "Architecture review",
    fetchPlaudSummaryExports: async () => [
      { title: "Architecture review", markdown: "# Architecture review\nBody" },
    ],
    downloadViaBackground: async (url, filename) => {
      calls.audio.push({ url, filename });
      return { success: true, downloadId: 1, filename };
    },
    downloadTextViaBackground: async (content, filename) => {
      calls.summaries.push({ content, filename });
      return { success: true, downloadId: 2, filename };
    },
  };
  return { calls, deps };
}

test("runExportAll fails closed when Plaud session or list is unavailable", async () => {
  for (const failure of [{ failSession: true }, { failList: true }]) {
    const { calls, deps } = makeHarness(failure);
    await assert.rejects(
      runExportAll(false, {
        exportMode: "both",
        tr: (key) =>
          key === "error.contentDirectApiUnavailable"
            ? "Refresh the Plaud tab and sign in again."
            : key,
        _deps: deps,
      }),
      /Refresh the Plaud tab and sign in again/
    );
    assert.equal(calls.audio.length, 0);
    assert.equal(calls.summaries.length, 0);
    assert.equal(calls.removed, 1);
  }
});

test("runExportAll preserves single and all export modes", async () => {
  for (const scope of ["single", "all"]) {
    for (const exportMode of ["both", "audio", "summary"]) {
      const { calls, deps } = makeHarness();
      const stats = await runExportAll(false, {
        exportMode,
        singleFile:
          scope === "single"
            ? { id: recording.id, title: recording.title }
            : undefined,
        _deps: deps,
      });

      assert.equal(stats.filesProcessed, 1);
      assert.equal(stats.filesErrored, 0);
      assert.equal(calls.audio.length, exportMode === "summary" ? 0 : 1);
      assert.equal(calls.summaries.length, exportMode === "audio" ? 0 : 1);
      assert.equal(stats.audioExported, calls.audio.length);
      assert.equal(stats.summariesExported, calls.summaries.length);
      assert.equal(calls.removed, 1);
    }
  }
});
