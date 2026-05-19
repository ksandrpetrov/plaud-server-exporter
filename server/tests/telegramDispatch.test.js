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
    answerCallbackQuery: record("answerCallbackQuery"),
    sendDocument: record("sendDocument"),
  };
}

async function withOwnerChatDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "plaud-dispatch-"));
  const file = join(dir, "owner-chat.json");
  const prev = process.env.PLAUD_OWNER_CHAT_PATH;
  process.env.PLAUD_OWNER_CHAT_PATH = file;
  try {
    return await fn({ dir, file });
  } finally {
    if (prev === undefined) delete process.env.PLAUD_OWNER_CHAT_PATH;
    else process.env.PLAUD_OWNER_CHAT_PATH = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

function ctx(telegram, overrides = {}) {
  return {
    telegram,
    allowedUsername: "aleksanderpetrov",
    allowedUserId: 100,
    runManualSync: async () => ({ status: "ok" }),
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
    await dispatchUpdate(
      ctx(tg),
      groupMessage({ text: "/menu", from: OWNER })
    );
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
    assert.equal(owner.chatId, 555, "owner chat must stay pinned to the first chatId");
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
  });
});

test("dispatch: id-only mode rejects squatted username", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg, { allowedUsername: "", allowedUserId: 100 }),
      privateMessage({ text: "/menu", from: { id: 999, username: "aleksanderpetrov" } })
    );
    assert.equal(tg.calls.length, 0);
  });
});

test("dispatch: username-only legacy mode still works for the matching username", async () => {
  await withOwnerChatDir(async () => {
    const tg = makeFakeTelegram();
    await dispatchUpdate(
      ctx(tg, { allowedUsername: "aleksanderpetrov", allowedUserId: null }),
      privateMessage({ text: "/menu", from: { id: 1, username: "AleksanderPetrov" } })
    );
    const sendMessages = tg.calls.filter((c) => c.name === "sendMessage");
    assert.equal(sendMessages.length, 1);
  });
});
