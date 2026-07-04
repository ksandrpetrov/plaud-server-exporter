import assert from "node:assert/strict";
import test from "node:test";
import { runSyncWithReporting } from "../src/telegram/syncOrchestrator.js";
import {
  SYNC_ACTION_MANUAL,
  syncRunGuard,
} from "../src/telegram/syncGuards.js";
import { SyncLockError } from "../src/sync/syncRunner.js";
import { PlaudAuthError } from "../src/plaud/plaudApiClient.js";

function fakeTelegram({ failFirstEdit = false } = {}) {
  const events = [];
  let nextMessageId = 100;
  let firstEdit = true;
  return {
    events,
    sendMessage: async ({ chatId, text, replyMarkup, messageEffectId }) => {
      const id = nextMessageId++;
      events.push({
        type: "send",
        chatId,
        text,
        replyMarkup,
        messageEffectId,
        messageId: id,
      });
      return { message_id: id };
    },
    editMessageText: async ({
      chatId,
      messageId,
      text,
      replyMarkup,
      messageEffectId,
    }) => {
      if (failFirstEdit && firstEdit) {
        firstEdit = false;
        const err = new Error("forced edit failure");
        throw err;
      }
      firstEdit = false;
      events.push({
        type: "edit",
        chatId,
        messageId,
        text,
        replyMarkup,
        messageEffectId,
      });
      return { message_id: messageId };
    },
    deleteMessage: async ({ chatId, messageId }) => {
      events.push({ type: "delete", chatId, messageId });
      return true;
    },
    sendMessageDraft: async ({ chatId, text }) => {
      events.push({ type: "draft", chatId, text });
      return true;
    },
    answerCallbackQuery: async () => true,
    close: () => {},
  };
}

const okSession = { token: "fake" };

const noSleep = () => Promise.resolve();
const HUGE_PULSE = 10_000_000;

test("manual sync edits the loading message into the final summary", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(42, SYNC_ACTION_MANUAL);
  const telegram = fakeTelegram();
  let now = 0;
  const result = await runSyncWithReporting({
    telegram,
    chatId: 42,
    source: "manual",
    loadingMessageId: 555,
    sessionLoader: async () => okSession,
    nowMs: () => (now += 1000),
    sleep: noSleep,
    pulseFrameMs: HUGE_PULSE,
    syncRunner: async ({ onProgress }) => {
      onProgress?.({ processed: 1, total: 2 });
      now += 3_000; // pass the 2s throttle on the next call
      onProgress?.({ processed: 2, total: 2 });
      return {
        status: "completed",
        new: 1,
        updated: 0,
        unchanged: 1,
        skipped: 0,
        errors: 0,
      };
    },
  });

  assert.equal(result.status, "ok");
  const thinkingDraft = telegram.events.find(
    (e) => e.type === "draft" && e.text === ""
  );
  assert.ok(
    thinkingDraft,
    "draft-live manual sync opens thinking bubble instead of editing callback"
  );
  const loadingEdit = telegram.events.find(
    (e) => e.type === "edit" && /Запускаю синк/.test(e.text)
  );
  assert.equal(
    loadingEdit,
    undefined,
    "must not create a parallel loading edit while draft stream is live"
  );

  const finalSend = telegram.events.find(
    (e) => e.type === "send" && /Синк завершён/.test(e.text)
  );
  assert.ok(finalSend, "draft finish should send summary into chat");
  assert.match(finalSend.text, /Новых: 1/);
  const loadingDelete = telegram.events.find(
    (e) => e.type === "delete" && e.messageId === 555
  );
  assert.ok(
    loadingDelete,
    "should delete the in-chat loading bubble after the final send"
  );
  syncRunGuard.reset();
});

test("scheduled sync sends a fresh message instead of editing", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(42, SYNC_ACTION_MANUAL);
  const telegram = fakeTelegram();
  const result = await runSyncWithReporting({
    telegram,
    chatId: 42,
    source: "scheduled",
    loadingMessageId: null,
    sessionLoader: async () => okSession,
    nowMs: () => Date.now(),
    sleep: noSleep,
    pulseFrameMs: HUGE_PULSE,
    syncRunner: async () => ({
      status: "completed",
      new: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
    }),
  });

  assert.equal(result.status, "ok");
  const sends = telegram.events.filter((e) => e.type === "send");
  // First "loading" sendMessage, then a final edit replaces it.
  assert.ok(sends.length >= 1);
  assert.match(sends[0].text, /Автозапуск/);
  syncRunGuard.reset();
});

test("SyncLockError turns into a friendly busy message", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(1, SYNC_ACTION_MANUAL);
  const telegram = fakeTelegram();
  const result = await runSyncWithReporting({
    telegram,
    chatId: 1,
    source: "manual",
    loadingMessageId: null,
    sessionLoader: async () => okSession,
    nowMs: () => Date.now(),
    sleep: noSleep,
    pulseFrameMs: HUGE_PULSE,
    syncRunner: async () => {
      throw new SyncLockError("busy", null);
    },
  });
  assert.equal(result.status, "lock_busy");
  const final = telegram.events.find(
    (e) =>
      (e.type === "send" || e.type === "edit") &&
      /Уже идёт другой синк/.test(e.text)
  );
  assert.ok(final, "should surface the lock-busy message");
  syncRunGuard.reset();
});

test("missing session reports SYNC_NO_SESSION_HTML", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(1, SYNC_ACTION_MANUAL);
  const telegram = fakeTelegram();
  let syncCalled = false;
  const result = await runSyncWithReporting({
    telegram,
    chatId: 1,
    source: "manual",
    loadingMessageId: null,
    sessionLoader: async () => null,
    sleep: noSleep,
    pulseFrameMs: HUGE_PULSE,
    syncRunner: async () => {
      syncCalled = true;
      return {};
    },
  });
  assert.equal(result.status, "no_session");
  assert.equal(syncCalled, false);
  const final = telegram.events.find(
    (e) =>
      (e.type === "send" || e.type === "edit") &&
      /Сессия Plaud не найдена/.test(e.text)
  );
  assert.ok(final);
  syncRunGuard.reset();
});

test("PlaudAuthError reports the auth-rejected message", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(1, SYNC_ACTION_MANUAL);
  const telegram = fakeTelegram();
  const result = await runSyncWithReporting({
    telegram,
    chatId: 1,
    source: "manual",
    loadingMessageId: null,
    sessionLoader: async () => okSession,
    sleep: noSleep,
    pulseFrameMs: HUGE_PULSE,
    syncRunner: async () => {
      throw new PlaudAuthError("token expired");
    },
  });
  assert.equal(result.status, "auth_rejected");
  const final = telegram.events.find(
    (e) =>
      (e.type === "send" || e.type === "edit") &&
      /Plaud отверг сессию/.test(e.text)
  );
  assert.ok(final);
  syncRunGuard.reset();
});

test("manual sync success may attach message effect in private chat", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(42, SYNC_ACTION_MANUAL);
  const telegram = fakeTelegram();
  await runSyncWithReporting({
    telegram,
    chatId: 42,
    source: "manual",
    loadingMessageId: null,
    sessionLoader: async () => okSession,
    sleep: noSleep,
    pulseFrameMs: HUGE_PULSE,
    syncRunner: async () => ({
      status: "completed",
      new: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
    }),
  });
  const withEffect = telegram.events.find(
    (e) => (e.type === "edit" || e.type === "send") && e.messageEffectId
  );
  assert.ok(withEffect, "expected sparkle effect on final reveal");
  syncRunGuard.reset();
});

test("GPT-style reveal: thinking draft then sendMessage (no final edit snap)", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(42, SYNC_ACTION_MANUAL);
  const telegram = fakeTelegram();
  await runSyncWithReporting({
    telegram,
    chatId: 42,
    source: "scheduled",
    loadingMessageId: null,
    sessionLoader: async () => okSession,
    sleep: noSleep,
    pulseFrameMs: HUGE_PULSE,
    syncRunner: async () => ({
      status: "completed",
      new: 1200,
      updated: 300,
      unchanged: 4000,
      skipped: 12,
      errors: 0,
      plaudChanged: true,
    }),
  });
  const summaryDrafts = telegram.events.filter(
    (e) => e.type === "draft" && /Автозапуск|Новых/i.test(e.text)
  );
  assert.ok(
    summaryDrafts.length >= 2,
    `expected several smooth draft frames, got ${summaryDrafts.length}`
  );
  const summarySends = telegram.events.filter(
    (e) => e.type === "send" && /Новых: 1200/.test(e.text)
  );
  assert.equal(
    summarySends.length,
    1,
    "draft-mode finish must land the summary via sendMessage like Чайка"
  );
  const summaryEdits = telegram.events.filter(
    (e) => e.type === "edit" && /Новых: 1200/.test(e.text)
  );
  assert.equal(
    summaryEdits.length,
    0,
    "draft-mode finish must not snap the summary via editMessageText"
  );
  syncRunGuard.reset();
});
