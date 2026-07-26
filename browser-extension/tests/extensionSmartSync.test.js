import assert from "node:assert/strict";
import test from "node:test";

import { runSmartSync } from "../features/audioExport/extensionSmartSync.js";

test("runSmartSync orchestrates files, settings and progress", async () => {
  const index = {
    v: 1,
    records: {},
    settings: {},
    updatedAt: new Date(0).toISOString(),
  };
  const files = [
    {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "One",
      raw: { file_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    },
    {
      id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "Two",
      raw: { file_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    },
  ];
  const processed = [];
  const progress = [];
  let saved = 0;

  const result = await runSmartSync({
    syncSubdirectory: "../Unsafe//Team",
    syncMode: "summary",
    onProgress: (data) => progress.push(data),
    _deps: {
      loadSyncIndex: async () => index,
      saveSyncIndex: async (value) => {
        saved++;
        return value;
      },
      getPlaudSession: async () => ({ authHeader: "Bearer test" }),
      fetchPlaudFilesFromApi: async () => files,
      mergeDomRecordingIdsIntoFiles: () => ({ domMerged: 0, domSeen: 0 }),
      mergeLocalStorageRecordingIdsIntoFiles: () => ({
        lsMerged: 0,
        lsSeen: 0,
        lsFromLocal: 0,
        ssFromSession: 0,
      }),
      getCurrentPlaudSourceUrl: () => "https://web.plaud.ai",
      processSmartSyncFile: async (params) => {
        processed.push(params.file.id);
        params.stats.processed++;
        params.stats.new++;
        params.progress({ lastMessage: params.file.title });
      },
    },
  });

  assert.deepEqual(
    processed,
    files.map((file) => file.id)
  );
  assert.equal(result.status, "completed");
  assert.equal(result.total, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.new, 2);
  assert.equal(result.summariesDownloaded, 0);
  assert.equal(index.settings.syncMode, "summary");
  assert.equal(index.settings.storageMode, "downloads_subfolder");
  assert.ok(saved >= 1);
  assert.ok(progress.length >= 4);
});
