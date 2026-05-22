/**
 * Unit tests for `botSettings.js`.
 *
 * Pin down the contract handlers rely on:
 *
 * - The on-disk record always carries both `intervalMin` and
 *   `scheduledSummaryVisible`; legacy records (only `intervalMin`) load as
 *   "summary off" so existing installs default to silent autosync.
 * - `saveBotSettings` accepts partial input and preserves the missing fields
 *   from the previously persisted record. This is what lets the toggle
 *   callback flip just the visibility without re-typing the interval.
 * - `loadEffective*` helpers fall back to `.env` defaults when the file is
 *   absent, matching the behaviour the scheduler relies on at first boot.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SCHEDULED_SUMMARY_VISIBLE,
  loadBotSettings,
  loadEffectiveIntervalMin,
  loadEffectiveScheduledSummaryVisible,
  saveBotSettings,
} from "../src/telegram/botSettings.js";

async function withSettingsFile(fn) {
  const dir = await mkdtemp(join(tmpdir(), "plaud-bot-settings-"));
  const file = join(dir, "bot-settings.json");
  const prev = process.env.PLAUD_BOT_SETTINGS_PATH;
  process.env.PLAUD_BOT_SETTINGS_PATH = file;
  try {
    return await fn({ dir, file });
  } finally {
    if (prev === undefined) delete process.env.PLAUD_BOT_SETTINGS_PATH;
    else process.env.PLAUD_BOT_SETTINGS_PATH = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

test("DEFAULT_SCHEDULED_SUMMARY_VISIBLE is false (silent autosync by default)", () => {
  assert.equal(DEFAULT_SCHEDULED_SUMMARY_VISIBLE, false);
});

test("loadBotSettings returns null when file does not exist", async () => {
  await withSettingsFile(async ({ file }) => {
    assert.equal(await loadBotSettings(file), null);
  });
});

test("loadBotSettings parses a full record", async () => {
  await withSettingsFile(async ({ file }) => {
    await writeFile(
      file,
      JSON.stringify({
        intervalMin: 240,
        scheduledSummaryVisible: true,
        updatedAt: "2026-05-22T10:00:00.000Z",
      })
    );
    const record = await loadBotSettings(file);
    assert.deepEqual(record, {
      intervalMin: 240,
      scheduledSummaryVisible: true,
      updatedAt: "2026-05-22T10:00:00.000Z",
    });
  });
});

test("loadBotSettings legacy record (no visibility field) defaults to silent", async () => {
  await withSettingsFile(async ({ file }) => {
    await writeFile(
      file,
      JSON.stringify({
        intervalMin: 120,
        updatedAt: "2026-05-21T00:00:00.000Z",
      })
    );
    const record = await loadBotSettings(file);
    assert.ok(record);
    assert.equal(record.intervalMin, 120);
    assert.equal(
      record.scheduledSummaryVisible,
      false,
      "legacy records must inherit the silent default"
    );
  });
});

test("loadBotSettings ignores records with non-positive intervalMin", async () => {
  await withSettingsFile(async ({ file }) => {
    await writeFile(file, JSON.stringify({ intervalMin: 0 }));
    assert.equal(await loadBotSettings(file), null);
  });
});

test("saveBotSettings persists full record with both fields", async () => {
  await withSettingsFile(async ({ file }) => {
    const record = await saveBotSettings(
      { intervalMin: 60, scheduledSummaryVisible: true },
      file
    );
    assert.equal(record.intervalMin, 60);
    assert.equal(record.scheduledSummaryVisible, true);
    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.intervalMin, 60);
    assert.equal(raw.scheduledSummaryVisible, true);
    assert.ok(raw.updatedAt);
  });
});

test("saveBotSettings preserves intervalMin when only summary flag is provided", async () => {
  await withSettingsFile(async ({ file }) => {
    await saveBotSettings({ intervalMin: 480 }, file);
    const updated = await saveBotSettings(
      { scheduledSummaryVisible: true },
      file
    );
    assert.equal(updated.intervalMin, 480);
    assert.equal(updated.scheduledSummaryVisible, true);
  });
});

test("saveBotSettings preserves visibility flag when only interval is provided", async () => {
  await withSettingsFile(async ({ file }) => {
    await saveBotSettings(
      { intervalMin: 60, scheduledSummaryVisible: true },
      file
    );
    const updated = await saveBotSettings({ intervalMin: 120 }, file);
    assert.equal(updated.intervalMin, 120);
    assert.equal(
      updated.scheduledSummaryVisible,
      true,
      "interval change must not reset the visibility opt-in"
    );
  });
});

test("saveBotSettings rejects invalid intervalMin", async () => {
  await withSettingsFile(async ({ file }) => {
    await assert.rejects(
      saveBotSettings({ intervalMin: 0 }, file),
      /intervalMin must be a positive integer/
    );
  });
});

test("loadEffectiveScheduledSummaryVisible falls back to the silent default", async () => {
  await withSettingsFile(async () => {
    assert.equal(await loadEffectiveScheduledSummaryVisible(), false);
  });
});

test("loadEffectiveScheduledSummaryVisible reflects persisted opt-in", async () => {
  await withSettingsFile(async ({ file }) => {
    await saveBotSettings(
      { intervalMin: 60, scheduledSummaryVisible: true },
      file
    );
    assert.equal(await loadEffectiveScheduledSummaryVisible(), true);
  });
});

test("loadEffectiveIntervalMin returns persisted value when present", async () => {
  await withSettingsFile(async ({ file }) => {
    await saveBotSettings({ intervalMin: 240 }, file);
    assert.equal(await loadEffectiveIntervalMin(), 240);
  });
});
