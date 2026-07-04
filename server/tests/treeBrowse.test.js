import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PLAUD_FOLDER_UNFILED } from "../src/plaud/plaudFolders.js";
import {
  _resetTreeBrowseHooksForTests,
  _setTreeBrowseHooksForTests,
  handleTreeFilePick,
  loadTreeSource,
  showFilesTreeRoot,
} from "../src/telegram/treeBrowse.js";
import {
  _resetTreeBrowseStateForTests,
  setTreeBrowseState,
} from "../src/telegram/treeBrowseState.js";

const DISK_INDEX = {
  records: {
    "plaud:disk": {
      stableId: "plaud:disk",
      title: "Disk only",
      folderSegment: PLAUD_FOLDER_UNFILED,
      summaryPath: "/vault/disk.md",
      status: "success",
    },
  },
};

const LIVE_INDEX = {
  records: {
    "plaud:live": {
      stableId: "plaud:live",
      title: "From Plaud",
      folderSegment: "Work",
      summaryPath: "",
      status: "not_synced",
    },
  },
};

function fakeCtx(overrides = {}) {
  const edits = [];
  const sends = [];
  const documents = [];
  const richMessages = [];
  const drafts = [];
  const deletes = [];
  return {
    edits,
    sends,
    documents,
    richMessages,
    drafts,
    deletes,
    runSyncQuiet: overrides.runSyncQuiet,
    telegram: {
      sendMessageDraft: async ({ chatId, draftId, text }) => {
        drafts.push({ chatId, draftId, text });
        return true;
      },
      sendMessage: async ({ chatId, text }) => {
        sends.push({ chatId, text });
        return { message_id: sends.length + 200 };
      },
      deleteMessage: async ({ chatId, messageId }) => {
        deletes.push({ chatId, messageId });
        return true;
      },
      editMessageText: async ({ chatId, messageId, text }) => {
        edits.push({ chatId, messageId, text });
        return { message_id: messageId };
      },
      sendDocument: async ({
        chatId,
        documentPath,
        caption,
        messageEffectId,
      }) => {
        documents.push({ chatId, documentPath, caption, messageEffectId });
        return { message_id: 300 };
      },
      sendRichMessage: async ({ chatId, markdown }) => {
        richMessages.push({ chatId, markdown });
        return { message_id: 301 };
      },
    },
  };
}

test.afterEach(() => {
  _resetTreeBrowseHooksForTests();
  _resetTreeBrowseStateForTests();
});

test("loadTreeSource prefers non-empty live index over disk index", async () => {
  _setTreeBrowseHooksForTests({
    loadIndex: async () => DISK_INDEX,
    loadLive: async () => LIVE_INDEX,
  });
  const source = await loadTreeSource();
  assert.equal(source.records["plaud:live"]?.title, "From Plaud");
  assert.equal(source.records["plaud:disk"], undefined);
});

test("loadTreeSource falls back to disk when live fetch throws", async () => {
  _setTreeBrowseHooksForTests({
    loadIndex: async () => DISK_INDEX,
    loadLive: async () => {
      throw new Error("network down");
    },
  });
  const source = await loadTreeSource();
  assert.equal(source.records["plaud:disk"]?.title, "Disk only");
});

test("loadTreeSource falls back when live index is empty", async () => {
  _setTreeBrowseHooksForTests({
    loadIndex: async () => DISK_INDEX,
    loadLive: async () => ({ records: {} }),
  });
  const source = await loadTreeSource();
  assert.equal(source.records["plaud:disk"]?.title, "Disk only");
});

test("showFilesTreeRoot edits menu with folder list from tree source", async () => {
  _setTreeBrowseHooksForTests({
    loadIndex: async () => LIVE_INDEX,
    loadLive: async () => null,
  });
  const ctx = fakeCtx();
  await showFilesTreeRoot(ctx, { chatId: 42, messageId: 99 });

  assert.equal(ctx.deletes.length, 1);
  assert.equal(ctx.richMessages.length, 1);
  assert.match(ctx.richMessages[0].markdown, /Work/);
  assert.match(ctx.richMessages[0].markdown, /1 записей/);
});

test("showFilesTreeRoot does not open a thinking draft (inline edit only)", async () => {
  _setTreeBrowseHooksForTests({
    loadIndex: async () => LIVE_INDEX,
    loadLive: async () => null,
  });
  const ctx = fakeCtx();
  await showFilesTreeRoot(ctx, { chatId: 42, messageId: 99 });

  assert.equal(
    ctx.drafts.length,
    0,
    "tree navigation edits the menu in place; no orphan draft bubble"
  );
});

test("handleTreeFilePick sends document when summary file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-pick-"));
  const mdPath = join(root, "note.md");
  await writeFile(mdPath, "# Hello\n", "utf8");

  await setTreeBrowseState(55, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:x", title: "Note", summaryPath: mdPath }],
  });

  const ctx = fakeCtx();
  await handleTreeFilePick(ctx, { chatId: 55, pick: 1 });

  assert.equal(ctx.documents.length, 1);
  assert.equal(ctx.documents[0].documentPath, mdPath);
  assert.match(ctx.documents[0].caption, /Note/);
  assert.equal(ctx.richMessages.length, 1);
  assert.match(ctx.richMessages[0].markdown, /Отправил/);
});

test("handleTreeFilePick still sends document when rich preview fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-rich-fail-"));
  const mdPath = join(root, "note.md");
  await writeFile(mdPath, "# Hello\n", "utf8");

  await setTreeBrowseState(56, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:y", title: "Fail rich", summaryPath: mdPath }],
  });

  const ctx = fakeCtx();
  ctx.telegram.sendRichMessage = async () => {
    throw new Error("sendRichMessage: method not found");
  };

  await handleTreeFilePick(ctx, { chatId: 56, pick: 1 });

  assert.equal(ctx.documents.length, 1);
  assert.equal(ctx.documents[0].documentPath, mdPath);
});

test("handleTreeFilePick runs quiet sync when file is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-sync-"));
  const mdPath = join(root, "after-sync.md");
  await mkdir(root, { recursive: true });

  let syncRuns = 0;
  _setTreeBrowseHooksForTests({
    loadIndex: async () => ({
      records: {
        "plaud:sync": {
          stableId: "plaud:sync",
          summaryPath: mdPath,
        },
      },
    }),
  });

  await setTreeBrowseState(77, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:sync", title: "Needs sync", summaryPath: "" }],
  });

  const ctx = fakeCtx({
    runSyncQuiet: async ({ onProgress }) => {
      syncRuns++;
      onProgress?.({
        processed: 1,
        total: 1,
        lastMessage: "Synced: Needs sync",
      });
      await writeFile(mdPath, "# synced\n", "utf8");
      return { status: "ok" };
    },
  });

  await handleTreeFilePick(ctx, { chatId: 77, pick: 1 });

  assert.equal(syncRuns, 1);
  assert.ok(
    ctx.sends.some((m) => /синхронизирую/i.test(m.text)),
    "quiet sync should toast before streaming progress"
  );
  assert.ok(
    ctx.drafts.some((d) => /Идёт синк|Synced:/.test(d.text)),
    "quiet sync should stream progress in draft instead of a static toast"
  );
  assert.equal(
    ctx.deletes.length,
    1,
    "draft bubble dismissed after quiet sync"
  );
  assert.equal(ctx.documents.length, 1);
  assert.equal(ctx.documents[0].documentPath, mdPath);
});

test("handleTreeFilePick reports out-of-range pick", async () => {
  await setTreeBrowseState(88, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:a", title: "One", summaryPath: "/x.md" }],
  });
  const ctx = fakeCtx();
  await handleTreeFilePick(ctx, { chatId: 88, pick: 9 });
  assert.equal(ctx.documents.length, 0);
  assert.ok(ctx.richMessages.some((m) => /Нет файла/i.test(m.markdown)));
});
