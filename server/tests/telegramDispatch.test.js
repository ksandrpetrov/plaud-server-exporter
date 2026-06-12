/**
 * Integration-style tests for handler dispatch.
 *
 * These tests pin down the three layers of the authorization gate:
 *
 *   1. `chat.type === "private"` — group/supergroup/channel messages and
 *      callbacks must produce zero outgoing Telegram traffic.
 *   2. `from.id === TELEGRAM_ALLOWED_USER_ID` — wrong-id senders are silent.
 *   3. `from.username` — when an expected username is configured, foreign
 *      usernames are silent.
 *
 * We exercise both `message` and `callback_query` paths so a future refactor
 * can't accidentally weaken one branch.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchUpdate } from "../src/telegram/handlers.js";
import { loadBotSettings } from "../src/telegram/botSettings.js";
import { createMessageAnimator } from "../src/telegram/messageAnimator.js";
import {
  SYNC_ACTION_MANUAL,
  syncRunGuard,
} from "../src/telegram/syncGuards.js";
import { syncBusyText } from "../src/telegram/messages.js";

function makeFakeTelegram() {
  const calls = [];
  const record =
    (name) =>
    async (...args) => {
      calls.push({ name, args });
      return { message_id: 1 };
    };
  return {
    calls,
    sendMessage: record("sendMessage"),
    editMessageText: record("editMessageText"),
    sendMessageDraft: record("sendMessageDraft"),
    answerCallbackQuery: record("answerCallbackQuery"),
    sendDocument: record("sendDocument"),
  };
}

async function withOwnerChatDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "plaud-dispatch-"));
  const file = join(dir, "owner-chat.json");
  const settingsFile = join(dir, "bot-settings.json");
  const prevOwner = process.env.PLAUD_OWNER_CHAT_PATH;
  const prevSettings = process.env.PLAUD_BOT_SETTINGS_PATH;
  process.env.PLAUD_OWNER_CHAT_PATH = file;
  process.env.PLAUD_BOT_SETTINGS_PATH = settingsFile;
  try {
    return await fn({ dir, file, settingsFile });
  } finally {
    if (prevOwner === undefined) delete process.env.PLAUD_OWNER_CHAT_PATH;
    else process.env.PLAUD_OWNER_CHAT_PATH = prevOwner;
    if (prevSettings === undefined) delete process.env.PLAUD_BOT_SETTINGS_PATH;
    else process.env.PLAUD_BOT_SETTINGS_PATH = prevSettings;
    await rm(dir, { recursive: true, force: true });
  }
}

function ctx(telegram, overrides = {}) {
  return {
    telegram,
    allowedUsername: "aleksanderpetrov",
    allowedUserId: 100,
    runManualSync: async () => ({ status: "ok" }),
    runSyncQuiet: async () => ({ status: "ok" }),
    ...overrides,
  };
}

function privateMessage({ text, from, chatId = 100 }) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      text,
      chat: { id: chatId, type: "private" },
      from,
    },
  };
}

function groupMessage({ text, from, chatId = -100 }) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      text,
      chat: { id: chatId, type: "supergroup" },
      from,
    },
  };
}

function privateCallback({ data, from, chatId = 100 }) {
  return {
    update_id: 1,
    callback_query: {
      id: "cb-1",
      data,
      from,
      message: {
        message_id: 1,
        chat: { id: chatId, type: "private" },
      },
    },
  };
}

function groupCallback({ data, from, chatId = -100 }) {
  return {
    update_id: 1,
    callback_query: {
      id: "cb-1",
      data,
      from,
      message: {
        message_id: 1,
        chat: { id: chatId, type: "supergroup" },
      },
    },
  };
}

const OWNER = { id: 100, username: "AleksanderPetrov" };
const FOREIGN_USERNAME = { id: 100, username: "stranger" };
const FOREIGN_ID = { id: 999, username: "aleksanderpetrov" };
const FOREIGN_BOTH = { id: 999, username: "stranger" };

test("dispatch: owner /menu in private chat triggers exactly one sendMessage", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/menu", from: OWNER })
    );
    const sendMessages = tg.calls.filter((c) => c.name === "sendMessage");
    assert.equal(sendMessages.length, 1, "owner /menu must produce one reply");
  });
});

test("dispatch: foreign-id sender in private chat is silently ignored", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/menu", from: FOREIGN_ID })
    );
    assert.equal(tg.calls.length, 0, "no Telegram traffic for wrong user id");
  });
});

test("dispatch: foreign-username sender in private chat is silently ignored", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/menu", from: FOREIGN_USERNAME })
    );
    assert.equal(tg.calls.length, 0);
  });
});

test("dispatch: foreign /start in private chat is silently ignored (no PRIVATE_HINT leak)", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/start", from: FOREIGN_BOTH })
    );
    assert.equal(
      tg.calls.length,
      0,
      "previously /start replied with BOT_PRIVATE_HINT; now it must stay silent"
    );
  });
});

test("dispatch: foreign /help in private chat is silently ignored", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/help", from: FOREIGN_BOTH })
    );
    assert.equal(tg.calls.length, 0);
  });
});

test("dispatch: owner /menu in a GROUP chat is silently ignored", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(ctx(tg), groupMessage({ text: "/menu", from: OWNER }));
    assert.equal(
      tg.calls.length,
      0,
      "menu in a group would leak data to other members"
    );
  });
});

test("dispatch: owner /start in a GROUP chat does NOT capture the group as owner chat", async () => {
  await withOwnerChatDir(async ({ file }) => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      groupMessage({ text: "/start", from: OWNER, chatId: -123 })
    );
    const { loadOwnerChat } = await import("../src/telegram/ownerChat.js");
    const owner = await loadOwnerChat(file);
    assert.equal(owner, null, "group chat must not become the owner chat");
  });
});

test("dispatch: owner /start in private chat IS captured as owner chat", async () => {
  await withOwnerChatDir(async ({ file }) => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/start", from: OWNER, chatId: 555 })
    );
    const { loadOwnerChat } = await import("../src/telegram/ownerChat.js");
    const owner = await loadOwnerChat(file);
    assert.ok(owner, "first /start in private chat must persist owner");
    assert.equal(owner.chatId, 555);
    assert.equal(owner.username, "aleksanderpetrov");
    assert.equal(owner.userId, 100);
  });
});

test("dispatch: second /start with a DIFFERENT chatId does not move owner chat", async () => {
  await withOwnerChatDir(async ({ file }) => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/start", from: OWNER, chatId: 555 })
    );
    await dispatchUpdate(
      ctx(tg),
      privateMessage({ text: "/start", from: OWNER, chatId: 777 })
    );
    const { loadOwnerChat } = await import("../src/telegram/ownerChat.js");
    const owner = await loadOwnerChat(file);
    assert.equal(
      owner.chatId,
      555,
      "owner chat must stay pinned to the first chatId"
    );
  });
});

test("dispatch: foreign callback_query in private chat is silent except answerCallbackQuery", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateCallback({ data: "run_sync", from: FOREIGN_BOTH })
    );
    const names = tg.calls.map((c) => c.name);
    assert.deepEqual(
      names,
      ["answerCallbackQuery"],
      "foreign callback gets only the loading-clock ack; no editMessage / runSync"
    );
  });
});

test("dispatch: callback_query from owner in a GROUP is silent except answerCallbackQuery", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    let manualSyncRan = false;
    await dispatchUpdate(
      ctx(tg, {
        runManualSync: async () => {
          manualSyncRan = true;
        },
      }),
      groupCallback({ data: "run_sync", from: OWNER })
    );
    assert.equal(manualSyncRan, false, "runManualSync must not fire in groups");
    const names = tg.calls.map((c) => c.name);
    assert.deepEqual(names, ["answerCallbackQuery"]);
  });
});

test("dispatch: owner callback_query in private chat triggers runManualSync", async () => {
  await withOwnerChatDir(async () => {
    syncRunGuard.reset();
    const tg = makeFakeTelegram();
    let manualSyncRan = false;
    await dispatchUpdate(
      ctx(tg, {
        runManualSync: async () => {
          manualSyncRan = true;
        },
      }),
      privateCallback({ data: "run_sync", from: OWNER })
    );
    assert.equal(manualSyncRan, true);
    syncRunGuard.reset();
  });
});

test("dispatch: duplicate run_sync shows busy toast without second runManualSync", async () => {
  await withOwnerChatDir(async () => {
    syncRunGuard.reset();
    const tg = makeFakeTelegram();
    let runs = 0;
    assert.equal(syncRunGuard.tryAcquire(OWNER.id, SYNC_ACTION_MANUAL), true);
    await dispatchUpdate(
      ctx(tg, {
        runManualSync: async () => {
          runs += 1;
        },
      }),
      privateCallback({ data: "run_sync", from: OWNER })
    );
    assert.equal(runs, 0);
    const answer = tg.calls.find((c) => c.name === "answerCallbackQuery");
    assert.ok(answer, "should answer callback");
    const answerPayload = answer.args?.[0] || {};
    assert.equal(answerPayload.text, syncBusyText("manual"));
    const busySend = tg.calls.find(
      (c) =>
        c.name === "sendMessage" && c.args?.[0]?.text === syncBusyText("manual")
    );
    assert.ok(busySend, "duplicate sync should also post busy text in chat");
    syncRunGuard.reset();
  });
});

test("dispatch: id-only mode rejects squatted username", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg, { allowedUsername: "", allowedUserId: 100 }),
      privateMessage({
        text: "/menu",
        from: { id: 999, username: "aleksanderpetrov" },
      })
    );
    assert.equal(tg.calls.length, 0);
  });
});

test("dispatch: username-only legacy mode still works for the matching username", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg, { allowedUsername: "aleksanderpetrov", allowedUserId: null }),
      privateMessage({
        text: "/menu",
        from: { id: 1, username: "AleksanderPetrov" },
      })
    );
    const sendMessages = tg.calls.filter((c) => c.name === "sendMessage");
    assert.equal(sendMessages.length, 1);
  });
});

test("dispatch: with messageAnimator wired in, /menu sends ONE sendMessage + thinking draft frames", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    const animator = createMessageAnimator({
      telegram: tg,
      minLen: 1,
      sleep: () => Promise.resolve(),
      holdMs: 0,
    });
    await dispatchUpdate(
      ctx(tg, { messageAnimator: animator }),
      privateMessage({ text: "/menu", from: OWNER })
    );
    const sends = tg.calls.filter((c) => c.name === "sendMessage");
    const drafts = tg.calls.filter((c) => c.name === "sendMessageDraft");
    const edits = tg.calls.filter((c) => c.name === "editMessageText");
    assert.equal(
      sends.length,
      1,
      "animated /menu must send exactly one new message (the final delivery)"
    );
    assert.equal(
      edits.length,
      0,
      "animated /menu must never use editMessageText (snaps look jumpy)"
    );
    assert.ok(
      drafts.length >= 1,
      `animated /menu should preview the reply via sendMessageDraft, got ${drafts.length}`
    );
  });
});

test("dispatch: with messageAnimator wired in, status callback drafts then edits once", async () => {
  await withOwnerChatDir(async () => {
    syncRunGuard.reset();
    const tg = makeFakeTelegram();
    const animator = createMessageAnimator({
      telegram: tg,
      minLen: 1,
      sleep: () => Promise.resolve(),
      holdMs: 0,
    });
    await dispatchUpdate(
      ctx(tg, { messageAnimator: animator }),
      privateCallback({ data: "status", from: OWNER })
    );
    const sends = tg.calls.filter((c) => c.name === "sendMessage");
    const drafts = tg.calls.filter((c) => c.name === "sendMessageDraft");
    const edits = tg.calls.filter((c) => c.name === "editMessageText");
    assert.equal(
      sends.length,
      0,
      "status callback must never sendMessage; only edit"
    );
    assert.ok(
      drafts.length >= 1,
      "status callback should preview via sendMessageDraft"
    );
    assert.equal(
      edits.length,
      1,
      "status callback should edit the menu bubble once"
    );
    syncRunGuard.reset();
  });
});

test("dispatch: settings screen shows the silent default for scheduled summaries", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateCallback({ data: "settings", from: OWNER })
    );
    const edit = tg.calls.find((c) => c.name === "editMessageText");
    assert.ok(edit, "settings callback must edit the menu bubble");
    const text = edit.args?.[0]?.text || "";
    assert.match(
      text,
      /Сообщения автосинка/,
      "settings screen must mention scheduled-sync visibility"
    );
    assert.match(
      text,
      /выкл/,
      "default state must read as disabled (silent autosync)"
    );
  });
});

test("dispatch: toggling scheduled-summary flips persisted value and re-renders", async () => {
  await withOwnerChatDir(async ({ settingsFile }) => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateCallback({ data: "settings_toggle_summary", from: OWNER })
    );
    const persisted = await loadBotSettings(settingsFile);
    assert.ok(persisted, "toggle must create the settings file");
    assert.equal(
      persisted.scheduledSummaryVisible,
      true,
      "first tap opts the user in"
    );
    const edit = tg.calls.find((c) => c.name === "editMessageText");
    assert.ok(edit);
    assert.match(edit.args[0].text, /вкл/);

    tg.calls.length = 0;
    await dispatchUpdate(
      ctx(tg),
      privateCallback({ data: "settings_toggle_summary", from: OWNER })
    );
    const persistedAgain = await loadBotSettings(settingsFile);
    assert.equal(
      persistedAgain.scheduledSummaryVisible,
      false,
      "second tap returns to silent autosync"
    );
  });
});

test("dispatch: callback routing table reaches known menu actions", async () => {
  await withOwnerChatDir(async () => {
    const cases = [
      { data: "files", expectEdit: true },
      { data: "files_stats", expectEdit: true },
      { data: "help", expectEdit: true },
      { data: "back", expectEdit: true },
      { data: "settings_interval_60", expectEdit: true },
    ];
    for (const { data, expectEdit } of cases) {
      const tg = makeFakeTelegram();
      await dispatchUpdate(ctx(tg), privateCallback({ data, from: OWNER }));
      const edit = tg.calls.some((c) => c.name === "editMessageText");
      assert.equal(
        edit,
        expectEdit,
        `callback ${data} should ${expectEdit ? "" : "not "}edit the menu bubble`
      );
    }
  });
});

test("dispatch: files tree folder callback is routed without sendMessage", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg),
      privateCallback({ data: "tf:0:1", from: OWNER })
    );
    const sends = tg.calls.filter((c) => c.name === "sendMessage");
    assert.equal(
      sends.length,
      0,
      "folder callback must not send a new message"
    );
    assert.ok(
      tg.calls.some((c) => c.name === "editMessageText"),
      "folder callback should edit the existing bubble"
    );
  });
});
