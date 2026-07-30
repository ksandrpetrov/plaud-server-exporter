import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PLAUD_FOLDER_UNFILED } from "../src/plaud/plaudFolders.js";
import {
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
    treeBrowse: overrides.treeBrowse,
    telegram: {
      sendMessageDraft: async ({ chatId, draftId, text }) => {
        drafts.push({ chatId, draftId, text });
        return true;
      },
      sendMessage: async ({ chatId, text, parseMode, replyMarkup }) => {
        sends.push({ chatId, text, parseMode, replyMarkup });
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
      sendRichMessage: async ({
        chatId,
        markdown,
        replyMarkup,
        messageEffectId,
      }) => {
        richMessages.push({
          chatId,
          markdown,
          replyMarkup,
          messageEffectId,
        });
        return { message_id: 301 };
      },
      ...overrides.telegram,
    },
  };
}

test.afterEach(() => {
  _resetTreeBrowseStateForTests();
});

test("loadTreeSource prefers non-empty live index over disk index", async () => {
  const source = await loadTreeSource({
    loadIndex: async () => DISK_INDEX,
    loadLive: async () => LIVE_INDEX,
  });
  assert.equal(source.records["plaud:live"]?.title, "From Plaud");
  assert.equal(source.records["plaud:disk"], undefined);
});

test("loadTreeSource falls back to disk when live fetch throws", async () => {
  const source = await loadTreeSource({
    loadIndex: async () => DISK_INDEX,
    loadLive: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(source.records["plaud:disk"]?.title, "Disk only");
});

test("loadTreeSource falls back when live index is empty", async () => {
  const source = await loadTreeSource({
    loadIndex: async () => DISK_INDEX,
    loadLive: async () => ({ records: {} }),
  });
  assert.equal(source.records["plaud:disk"]?.title, "Disk only");
});

test("showFilesTreeRoot edits menu with folder list from tree source", async () => {
  const ctx = fakeCtx({
    treeBrowse: {
      loadTreeSource: async () => LIVE_INDEX,
    },
  });
  await showFilesTreeRoot(ctx, { chatId: 42, messageId: 99 });

  assert.equal(ctx.deletes.length, 1);
  assert.equal(ctx.richMessages.length, 1);
  assert.match(ctx.richMessages[0].markdown, /Work/);
  assert.match(ctx.richMessages[0].markdown, /1 записей/);
});

test("showFilesTreeRoot does not open a thinking draft (inline edit only)", async () => {
  const ctx = fakeCtx({
    treeBrowse: {
      loadTreeSource: async () => LIVE_INDEX,
    },
  });
  await showFilesTreeRoot(ctx, { chatId: 42, messageId: 99 });

  assert.equal(
    ctx.drafts.length,
    0,
    "tree navigation edits the menu in place; no orphan draft bubble"
  );
});

test("handleTreeFilePick opens a readable summary as rich markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-pick-"));
  const mdPath = join(root, "note.md");
  await writeFile(mdPath, "\uFEFF# Hello\n\nBody\n", "utf8");

  await setTreeBrowseState(55, {
    folderIndex: 0,
    page: 1,
    items: [
      {
        stableId: "plaud:x",
        title: "Note",
        date: "2026-07-30",
        folder: "Work",
        summaryPath: mdPath,
      },
    ],
  });

  const ctx = fakeCtx();
  await handleTreeFilePick(ctx, { chatId: 55, pick: 1 });

  assert.equal(ctx.documents.length, 0);
  assert.equal(ctx.richMessages.length, 1);
  assert.match(ctx.richMessages[0].markdown, /^# Note/);
  assert.match(ctx.richMessages[0].markdown, /2026-07-30 · Work/);
  assert.match(ctx.richMessages[0].markdown, /# Hello\n\nBody/);
  assert.doesNotMatch(ctx.richMessages[0].markdown, /\uFEFF/);
  assert.ok(ctx.richMessages[0].replyMarkup);
});

test("handleTreeFilePick splits a long summary into rich messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-long-"));
  const mdPath = join(root, "long.md");
  await writeFile(
    mdPath,
    `# Start\n\n${"long-word ".repeat(7000)}\n\n# End\n`,
    "utf8"
  );

  await setTreeBrowseState(57, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:long", title: "Long", summaryPath: mdPath }],
  });

  const ctx = fakeCtx();
  await handleTreeFilePick(ctx, { chatId: 57, pick: 1 });

  assert.ok(ctx.richMessages.length > 1);
  assert.ok(ctx.richMessages.every((part) => part.markdown.length <= 30000));
  assert.match(ctx.richMessages[0].markdown, /_Часть 1\//);
  assert.match(ctx.richMessages.at(-1).markdown, /# End/);
  assert.equal(
    ctx.richMessages
      .map((message) => message.markdown)
      .join("\n")
      .match(/long-word/g)?.length,
    7000
  );
  assert.ok(ctx.richMessages.at(-1).replyMarkup);
  assert.ok(
    ctx.richMessages
      .slice(0, -1)
      .every((message) => message.replyMarkup == null)
  );
  assert.equal(ctx.documents.length, 0);
});

test("handleTreeFilePick falls back to plain text when rich delivery fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-rich-fail-"));
  const mdPath = join(root, "note.md");
  await writeFile(mdPath, "# Hello\n", "utf8");

  await setTreeBrowseState(56, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:y", title: "Fail rich", summaryPath: mdPath }],
  });

  const ctx = fakeCtx({
    telegram: {
      sendRichMessage: async () => {
        throw new Error("sendRichMessage: method not found");
      },
    },
  });

  await handleTreeFilePick(ctx, { chatId: 56, pick: 1 });

  assert.equal(ctx.documents.length, 0);
  assert.equal(ctx.sends.length, 1);
  assert.match(ctx.sends[0].text, /# Fail rich[\s\S]*# Hello/);
  assert.equal(ctx.sends[0].parseMode, null);
  assert.ok(ctx.sends[0].replyMarkup);
});

test("handleTreeFilePick splits the complete plain-text fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-plain-long-"));
  const mdPath = join(root, "note.md");
  await writeFile(
    mdPath,
    `# Start\n\n${"plain-word ".repeat(1200)}\n\n# End\n`,
    "utf8"
  );

  await setTreeBrowseState(59, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:plain", title: "Plain", summaryPath: mdPath }],
  });

  const ctx = fakeCtx({
    telegram: {
      sendRichMessage: async () => {
        throw new Error("sendRichMessage: method not found");
      },
    },
  });

  await handleTreeFilePick(ctx, { chatId: 59, pick: 1 });

  assert.ok(ctx.sends.length > 1);
  assert.ok(ctx.sends.every((part) => part.text.length <= 3800));
  assert.ok(ctx.sends.every((part) => part.parseMode === null));
  assert.match(ctx.sends[0].text, /# Start/);
  assert.match(ctx.sends.at(-1).text, /# End/);
  assert.equal(
    ctx.sends
      .map((message) => message.text)
      .join("\n")
      .match(/plain-word/g)?.length,
    1200
  );
  assert.ok(ctx.sends.at(-1).replyMarkup);
  assert.equal(ctx.documents.length, 0);
});

test("handleTreeFilePick sends the document only when text delivery fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-doc-fallback-"));
  const mdPath = join(root, "note.md");
  await writeFile(mdPath, "# Hello\n", "utf8");

  await setTreeBrowseState(58, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:doc", title: "Fallback", summaryPath: mdPath }],
  });

  const ctx = fakeCtx({
    telegram: {
      sendRichMessage: async () => {
        throw new Error("sendRichMessage: method not found");
      },
      sendMessage: async ({ parseMode }) => {
        if (parseMode === null) throw new Error("plain send failed");
        return { message_id: 1 };
      },
    },
  });

  await handleTreeFilePick(ctx, { chatId: 58, pick: 1 });

  assert.equal(ctx.documents.length, 1);
  assert.equal(ctx.documents[0].documentPath, mdPath);
});

test("handleTreeFilePick does not sync again after Telegram delivery failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-delivery-fail-"));
  const mdPath = join(root, "note.md");
  await writeFile(mdPath, "# Hello\n", "utf8");
  let syncRuns = 0;
  const errorMessages = [];

  await setTreeBrowseState(60, {
    folderIndex: 0,
    page: 1,
    items: [{ stableId: "plaud:failed", title: "Failed", summaryPath: mdPath }],
  });

  const ctx = fakeCtx({
    runSyncQuiet: async () => {
      syncRuns++;
      return { status: "ok" };
    },
    telegram: {
      sendRichMessage: async ({ markdown }) => {
        if (/Не удалось открыть/.test(markdown)) {
          errorMessages.push(markdown);
          return { message_id: 1 };
        }
        throw new Error("rich send failed");
      },
      sendMessage: async ({ parseMode }) => {
        if (parseMode === null) throw new Error("plain send failed");
        return { message_id: 2 };
      },
      sendDocument: async () => {
        throw new Error("document send failed");
      },
    },
  });

  await handleTreeFilePick(ctx, { chatId: 60, pick: 1 });

  assert.equal(syncRuns, 0);
  assert.equal(errorMessages.length, 1);
});

test("handleTreeFilePick runs quiet sync when file is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "plaud-tree-sync-"));
  const mdPath = join(root, "after-sync.md");
  await mkdir(root, { recursive: true });

  let syncRuns = 0;

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
    treeBrowse: {
      resolveSummaryPathAfterSync: async (stableId) =>
        stableId === "plaud:sync" ? mdPath : null,
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
  assert.equal(ctx.documents.length, 0);
  assert.ok(ctx.richMessages.some((m) => /# synced/.test(m.markdown)));
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
