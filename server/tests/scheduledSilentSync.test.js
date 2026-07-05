import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNC_ACTION_SCHEDULED,
  syncRunGuard,
} from "../src/telegram/syncGuards.js";
import { runScheduledSync } from "../src/telegram/sync/scheduledSyncBridge.js";

test("runScheduledSync silent path calls runSyncSilent without Telegram traffic", async () => {
  syncRunGuard.reset();
  const telegramEvents = [];
  let silentArgs = null;
  const result = await runScheduledSync({
    chatId: 42,
    scheduledSummaryVisible: false,
    runSyncWithReporting: async () => {
      telegramEvents.push("reporting");
      return { status: "ok" };
    },
    runSyncSilent: async (args) => {
      silentArgs = args;
      return { status: "ok", stats: { new: 1 } };
    },
    messageAnimator: {
      send: async (args) => {
        telegramEvents.push(args);
      },
    },
  });
  assert.equal(result?.status, "ok");
  assert.deepEqual(silentArgs, { chatId: null });
  assert.equal(telegramEvents.length, 0);
});

test("runScheduledSync visible path uses runSyncWithReporting", async () => {
  syncRunGuard.reset();
  let reportingArgs = null;
  const result = await runScheduledSync({
    chatId: 99,
    scheduledSummaryVisible: true,
    runSyncWithReporting: async (args) => {
      reportingArgs = args;
      return { status: "ok" };
    },
    runSyncSilent: async () => {
      throw new Error("silent should not run");
    },
    messageAnimator: {
      send: async () => {
        throw new Error("telegram should not be used on happy path");
      },
    },
  });
  assert.equal(result?.status, "ok");
  assert.deepEqual(reportingArgs, {
    chatId: 99,
    loadingMessageId: null,
    source: "scheduled",
  });
});

test("runScheduledSync silent path stays quiet when ActionGuard is busy", async () => {
  syncRunGuard.reset();
  syncRunGuard.tryAcquire(42, SYNC_ACTION_SCHEDULED);
  const telegramEvents = [];
  let silentCalled = false;
  await runScheduledSync({
    chatId: 42,
    scheduledSummaryVisible: false,
    runSyncWithReporting: async () => ({ status: "ok" }),
    runSyncSilent: async () => {
      silentCalled = true;
      return { status: "ok" };
    },
    messageAnimator: {
      send: async (args) => {
        telegramEvents.push(args);
      },
    },
  });
  assert.equal(silentCalled, false);
  assert.equal(telegramEvents.length, 0);
});
