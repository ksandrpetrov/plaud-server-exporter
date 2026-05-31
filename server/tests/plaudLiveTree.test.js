/**
 * Unit tests for the live "Дерево синка" assembler used by the Telegram bot.
 *
 * The module sits between Plaud's API client (filetag list + recordings) and
 * the existing `buildSyncIndexTreeRoot` / `buildSyncIndexFolderPage` helpers.
 * Tests stub Plaud calls so we can pin down the exact bucketing rules:
 *
 * - `folderSegment` always comes from Plaud's filetag list (so legacy records
 *   with empty `folderSegment` still bucket correctly);
 * - the "All files" meta-tag is stripped;
 * - trash recordings (`is_trash: true`) land in the Trash bucket;
 * - sync status from the local sync-index overrides `not_synced` on a
 *   per-record basis without re-bucketing files into vault paths.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildStableId } from "../../plaud-exporter/common/syncCore.js";
import { getRecordingCreatedAtRaw } from "../src/plaud/recordingTimestamps.js";
import {
  PLAUD_FOLDER_TRASH,
  PLAUD_FOLDER_UNFILED,
  isAllFilesMetaTag,
} from "../src/plaud/plaudFolders.js";
import {
  _resetPlaudLiveTreeCache,
  loadPlaudLiveSyncTree,
} from "../src/plaud/liveTreeReadModel.js";
import {
  buildSyncIndexFolderPage,
  buildSyncIndexTreeRoot,
} from "../src/telegram/vaultTree.js";

const STUB_SESSION = { __stub: true };

function makeStubs({ tags, files }) {
  return {
    sessionLoader: async () => STUB_SESSION,
    fetchTags: async () => tags,
    fetchRecordings: async () => files,
  };
}

function testRecordingId(prefix, index) {
  const suffix = String(index).padStart(24, "0");
  return `${prefix}${suffix}`.slice(0, 32);
}

function recording({ id, title, folderIds = [], isTrash = false, createdAt }) {
  const resolvedId = id ?? testRecordingId("aa", 0);
  return {
    id: resolvedId,
    title,
    raw: {
      id: resolvedId,
      is_trash: isTrash,
      created_at: createdAt,
      filetag_id_list: folderIds,
    },
    folderIds,
    folderSegment: "",
  };
}

test("isAllFilesMetaTag matches localised names and system kinds", () => {
  assert.equal(isAllFilesMetaTag({ name: "All files" }), true);
  assert.equal(isAllFilesMetaTag({ name: "Все файлы" }), true);
  assert.equal(isAllFilesMetaTag({ name: "全部" }), true);
  assert.equal(isAllFilesMetaTag({ system_folder_type: "all" }), true);
  assert.equal(isAllFilesMetaTag({ is_all_files: true }), true);
  assert.equal(isAllFilesMetaTag({ name: "SocServ Dev" }), false);
  assert.equal(isAllFilesMetaTag({}), false);
  assert.equal(isAllFilesMetaTag(null), false);
});

test("loadPlaudLiveSyncTree buckets recordings by Plaud folder, skips 'All files'", async () => {
  _resetPlaudLiveTreeCache();
  const tags = [
    { id: "all", name: "All files", system_folder_type: "all" },
    { id: "unf", name: "Unfiled", is_unfiled: true },
    { id: "dev", name: "SocServ Dev" },
    { id: "cap", name: "SocServ Captains" },
  ];
  const files = [
    ...Array.from({ length: 10 }, (_, i) =>
      recording({
        id: testRecordingId("d1", i),
        title: `Dev ${i}`,
        folderIds: ["dev"],
      })
    ),
    ...Array.from({ length: 24 }, (_, i) =>
      recording({
        id: testRecordingId("c1", i),
        title: `Cap ${i}`,
        folderIds: ["cap"],
      })
    ),
    ...Array.from({ length: 14 }, (_, i) =>
      recording({
        id: testRecordingId("u1", i),
        title: `Unfiled ${i}`,
        folderIds: ["unf"],
      })
    ),
    ...Array.from({ length: 16 }, (_, i) =>
      recording({
        id: testRecordingId("t1", i),
        title: `Trash ${i}`,
        folderIds: ["dev"],
        isTrash: true,
      })
    ),
  ];

  const live = await loadPlaudLiveSyncTree({
    ...makeStubs({ tags, files }),
    syncIndex: { records: {} },
    forceRefresh: true,
  });
  assert.ok(live);

  const root = buildSyncIndexTreeRoot(live);
  assert.equal(root.total, 10 + 24 + 14 + 16);

  const labels = root.folders.map((f) => f.folder);
  assert.deepEqual(labels, [
    "SocServ Captains",
    "SocServ Dev",
    PLAUD_FOLDER_UNFILED,
    PLAUD_FOLDER_TRASH,
  ]);
  assert.deepEqual(
    root.folders.map((f) => f.count),
    [24, 10, 14, 16]
  );
});

test("loadPlaudLiveSyncTree overlays sync status from the local sync-index", async () => {
  _resetPlaudLiveTreeCache();
  const tags = [{ id: "dev", name: "SocServ Dev" }];
  const files = [
    recording({
      id: "abcdef0123456789abcdef0123456789",
      title: "Synced one",
      folderIds: ["dev"],
      createdAt: "2026-05-10T10:00:00.000Z",
    }),
    recording({
      id: "fedcba9876543210fedcba9876543210",
      title: "New one",
      folderIds: ["dev"],
      createdAt: "2026-05-12T10:00:00.000Z",
    }),
  ];
  const syncIndex = {
    records: {
      "plaud:abcdef0123456789abcdef0123456789": {
        title: "Synced one (local)",
        status: "success",
        summaryPath: "/vault/Plaud/SocServ Dev/2026-05-10 - Synced one.md",
        lastSyncedAt: "2026-05-10T10:30:00.000Z",
        folderSegment: "",
      },
    },
  };

  const live = await loadPlaudLiveSyncTree({
    ...makeStubs({ tags, files }),
    syncIndex,
    forceRefresh: true,
  });
  assert.ok(live);

  assert.equal(
    live.records["plaud:abcdef0123456789abcdef0123456789"].status,
    "success"
  );
  assert.equal(
    live.records["plaud:abcdef0123456789abcdef0123456789"].summaryPath,
    "/vault/Plaud/SocServ Dev/2026-05-10 - Synced one.md"
  );
  assert.equal(
    live.records["plaud:fedcba9876543210fedcba9876543210"].status,
    "not_synced"
  );

  const page = buildSyncIndexFolderPage(live, {
    folder: "SocServ Dev",
    page: 1,
    pageSize: 10,
  });
  assert.equal(page.exists, true);
  assert.equal(page.total, 2);
  assert.deepEqual(
    page.items.map((it) => it.status),
    ["not_synced", "success"]
  );
});

test("loadPlaudLiveSyncTree merges fingerprint stableIds from sync-index", async () => {
  _resetPlaudLiveTreeCache();
  const tags = [{ id: "dev", name: "SocServ Dev" }];
  const fingerprintInput = {
    sourceUrl: "https://web.plaud.ai/file/current?x=1",
    audioUrl: "https://api.plaud.ai/audio/object.mp3?signature=temp",
    title: "Fingerprint meeting",
    summaryMarkdown: "# Fingerprint meeting\nNotes",
    raw: {
      filetag_id_list: ["dev"],
      created_at: "2026-05-10T10:00:00.000Z",
    },
    folderIds: ["dev"],
    folderSegment: "",
  };
  const { stableId } = buildStableId({
    ...fingerprintInput,
    raw: fingerprintInput.raw,
    title: String(fingerprintInput.title || "").trim(),
    createdAt: getRecordingCreatedAtRaw(fingerprintInput.raw),
  });
  assert.match(stableId, /^fingerprint:/);

  const files = [fingerprintInput];
  const syncIndex = {
    records: {
      [stableId]: {
        title: "Fingerprint meeting (local)",
        status: "success",
        summaryPath:
          "/vault/Plaud/SocServ Dev/2026-05-10 - Fingerprint meeting.md",
        lastSyncedAt: "2026-05-10T10:30:00.000Z",
        folderSegment: "",
      },
    },
  };

  const live = await loadPlaudLiveSyncTree({
    ...makeStubs({ tags, files }),
    syncIndex,
    forceRefresh: true,
  });
  assert.ok(live);
  assert.equal(live.records[stableId].status, "success");
  assert.equal(
    live.records[stableId].summaryPath,
    "/vault/Plaud/SocServ Dev/2026-05-10 - Fingerprint meeting.md"
  );
});

test("loadPlaudLiveSyncTree matches sync-runner stableId for unix createdAt", async () => {
  _resetPlaudLiveTreeCache();
  const tags = [{ id: "dev", name: "SocServ Dev" }];
  const unixSeconds = 1700000000;
  const fingerprintInput = {
    sourceUrl: "https://web.plaud.ai/file/current?x=2",
    audioUrl: "https://api.plaud.ai/audio/object.mp3?signature=temp2",
    title: "Unix timestamp meeting",
    summaryMarkdown: "# Unix timestamp meeting\nNotes",
    raw: {
      filetag_id_list: ["dev"],
      create_time: unixSeconds,
    },
    folderIds: ["dev"],
    folderSegment: "",
  };
  const { stableId } = buildStableId({
    ...fingerprintInput,
    raw: fingerprintInput.raw,
    title: String(fingerprintInput.title || "").trim(),
    createdAt: getRecordingCreatedAtRaw(fingerprintInput.raw),
  });
  assert.match(stableId, /^fingerprint:/);

  const live = await loadPlaudLiveSyncTree({
    ...makeStubs({ tags, files: [fingerprintInput] }),
    syncIndex: {
      records: {
        [stableId]: {
          title: "Unix timestamp meeting",
          status: "success",
          summaryPath: "/vault/Plaud/SocServ Dev/unix.md",
          lastSyncedAt: "2026-05-10T10:30:00.000Z",
          folderSegment: "",
        },
      },
    },
    forceRefresh: true,
  });
  assert.ok(live?.records[stableId]);
  assert.equal(live.records[stableId].status, "success");
});

test("loadPlaudLiveSyncTree returns null when no session is available", async () => {
  _resetPlaudLiveTreeCache();
  const result = await loadPlaudLiveSyncTree({
    sessionLoader: async () => null,
    fetchTags: async () => [],
    fetchRecordings: async () => [],
    forceRefresh: true,
  });
  assert.equal(result, null);
});

test("loadPlaudLiveSyncTree returns null when the live fetch throws", async () => {
  _resetPlaudLiveTreeCache();
  const result = await loadPlaudLiveSyncTree({
    sessionLoader: async () => STUB_SESSION,
    fetchTags: async () => {
      throw new Error("network down");
    },
    fetchRecordings: async () => [],
    forceRefresh: true,
  });
  assert.equal(result, null);
});

test("loadPlaudLiveSyncTree caches results across calls inside the TTL", async () => {
  _resetPlaudLiveTreeCache();
  const tags = [{ id: "dev", name: "SocServ Dev" }];
  const files = [
    recording({
      id: testRecordingId("ab", 1),
      title: "One",
      folderIds: ["dev"],
    }),
  ];
  let tagCalls = 0;
  let fetchCalls = 0;

  const opts = {
    sessionLoader: async () => STUB_SESSION,
    fetchTags: async () => {
      tagCalls++;
      return tags;
    },
    fetchRecordings: async () => {
      fetchCalls++;
      return files;
    },
  };

  const t0 = 1_000_000;
  await loadPlaudLiveSyncTree({
    ...opts,
    syncIndex: null,
    now: t0,
    forceRefresh: true,
  });
  await loadPlaudLiveSyncTree({ ...opts, syncIndex: null, now: t0 + 5_000 });
  await loadPlaudLiveSyncTree({ ...opts, syncIndex: null, now: t0 + 14_000 });
  assert.equal(tagCalls, 1, "tags should be fetched once within TTL");
  assert.equal(fetchCalls, 1, "recordings should be fetched once within TTL");

  await loadPlaudLiveSyncTree({ ...opts, syncIndex: null, now: t0 + 16_000 });
  assert.equal(tagCalls, 2, "after TTL expiry tags refetch");
  assert.equal(fetchCalls, 2, "after TTL expiry recordings refetch");
});
