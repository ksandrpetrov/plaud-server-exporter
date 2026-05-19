import assert from "node:assert/strict";
import test from "node:test";
import { BotScheduler, isSyncDue } from "../src/telegram/scheduler.js";

test("isSyncDue returns true when there is no prior sync", () => {
  assert.equal(isSyncDue(null, 60, Date.now()), true);
  assert.equal(isSyncDue({}, 60, Date.now()), true);
  assert.equal(isSyncDue({ lastSyncAt: "" }, 60, Date.now()), true);
});

test("isSyncDue triggers only after the configured interval", () => {
  const lastSync = "2026-05-19T12:00:00.000Z";
  const lastMs = Date.parse(lastSync);

  assert.equal(
    isSyncDue({ lastSyncAt: lastSync }, 60, lastMs + 30 * 60_000),
    false,
    "half an hour after lastSync, with 60-min interval => not due"
  );
  assert.equal(
    isSyncDue({ lastSyncAt: lastSync }, 60, lastMs + 60 * 60_000),
    true,
    "exactly at the interval boundary => due"
  );
  assert.equal(
    isSyncDue({ lastSyncAt: lastSync }, 60, lastMs + 90 * 60_000),
    true
  );
});

test("isSyncDue treats invalid timestamps as 'due'", () => {
  assert.equal(isSyncDue({ lastSyncAt: "not-a-date" }, 60, 0), true);
});

test("BotScheduler.runOnce stays quiet before the startup grace window elapses", async () => {
  let now = 0;
  const calls = [];
  const sched = new BotScheduler({
    runOrchestrator: async (args) => calls.push(args),
    nowMs: () => now,
    startupDelayMs: 5_000,
    ownerChatReader: async () => ({ chatId: 1 }),
    statusReader: async () => null,
    intervalLoader: async () => 60,
    schedule: () => 1,
    cancel: () => {},
  });
  await sched.runOnce();
  assert.equal(calls.length, 0);
});

test("BotScheduler.runOnce fires the orchestrator when sync is due and owner chat exists", async () => {
  let now = Date.parse("2026-05-19T15:00:00.000Z");
  const calls = [];
  const sched = new BotScheduler({
    runOrchestrator: async (args) => calls.push(args),
    nowMs: () => now,
    startupDelayMs: 0,
    ownerChatReader: async () => ({ chatId: 777 }),
    statusReader: async () => ({
      lastSyncAt: "2026-05-19T10:00:00.000Z",
    }),
    intervalLoader: async () => 60,
    schedule: () => 1,
    cancel: () => {},
  });
  await sched.runOnce();
  assert.deepEqual(calls, [{ chatId: 777, source: "scheduled" }]);
});

test("BotScheduler.runOnce skips when no owner chat is captured yet", async () => {
  let now = Date.parse("2026-05-19T15:00:00.000Z");
  const calls = [];
  const sched = new BotScheduler({
    runOrchestrator: async (args) => calls.push(args),
    nowMs: () => now,
    startupDelayMs: 0,
    ownerChatReader: async () => null,
    statusReader: async () => ({
      lastSyncAt: "2026-05-19T10:00:00.000Z",
    }),
    intervalLoader: async () => 60,
    schedule: () => 1,
    cancel: () => {},
  });
  await sched.runOnce();
  assert.equal(calls.length, 0);
});

test("BotScheduler.runOnce skips when last sync is still within the interval", async () => {
  let now = Date.parse("2026-05-19T10:30:00.000Z");
  const calls = [];
  const sched = new BotScheduler({
    runOrchestrator: async (args) => calls.push(args),
    nowMs: () => now,
    startupDelayMs: 0,
    ownerChatReader: async () => ({ chatId: 1 }),
    statusReader: async () => ({
      lastSyncAt: "2026-05-19T10:00:00.000Z",
    }),
    intervalLoader: async () => 60,
    schedule: () => 1,
    cancel: () => {},
  });
  await sched.runOnce();
  assert.equal(calls.length, 0);
});
