import assert from "node:assert/strict";
import test from "node:test";
import {
  __setSyncNotificationsCacheForTests,
  setSyncNotificationsEnabledFromSettings,
  syncNotificationsEnabled,
} from "../common/syncNotificationGate.js";

test("syncNotificationsEnabled defaults to on until cache is explicitly false", () => {
  __setSyncNotificationsCacheForTests(null);
  assert.equal(syncNotificationsEnabled(), true);

  __setSyncNotificationsCacheForTests(true);
  assert.equal(syncNotificationsEnabled(), true);

  __setSyncNotificationsCacheForTests(false);
  assert.equal(syncNotificationsEnabled(), false);
});

test("setSyncNotificationsEnabledFromSettings respects sync-index settings", () => {
  setSyncNotificationsEnabledFromSettings({ syncNotificationsEnabled: false });
  assert.equal(syncNotificationsEnabled(), false);

  setSyncNotificationsEnabledFromSettings({ syncNotificationsEnabled: true });
  assert.equal(syncNotificationsEnabled(), true);

  setSyncNotificationsEnabledFromSettings(undefined);
  assert.equal(syncNotificationsEnabled(), true);
});
