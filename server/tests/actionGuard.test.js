import assert from "node:assert/strict";
import test from "node:test";
import { ActionGuard } from "../src/telegram/actionGuard.js";

test("ActionGuard blocks second acquire while running", () => {
  const guard = new ActionGuard({ cooldownSec: 60 });
  assert.equal(guard.tryAcquire(1, "sync"), true);
  assert.equal(guard.tryAcquire(1, "sync"), false);
  guard.release(1, "sync", { sent: false });
  assert.equal(guard.tryAcquire(1, "sync"), true);
  guard.release(1, "sync", { sent: false });
});

test("ActionGuard enforces cooldown after successful release", () => {
  const guard = new ActionGuard({ cooldownSec: 0.05 });
  assert.equal(guard.tryAcquire(9, "sync"), true);
  guard.release(9, "sync", { sent: true });
  assert.equal(guard.tryAcquire(9, "sync"), false);
});

test("ActionGuard does not cooldown after failed release", async () => {
  const guard = new ActionGuard({ cooldownSec: 60 });
  assert.equal(guard.tryAcquire(2, "sync"), true);
  guard.release(2, "sync", { sent: false });
  assert.equal(guard.tryAcquire(2, "sync"), true);
  guard.release(2, "sync", { sent: false });
});

test("ActionGuard reset clears state", () => {
  const guard = new ActionGuard({ cooldownSec: 60 });
  assert.equal(guard.tryAcquire(3, "sync"), true);
  guard.reset();
  assert.equal(guard.tryAcquire(3, "sync"), true);
  guard.release(3, "sync", { sent: false });
});
