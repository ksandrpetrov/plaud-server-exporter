/**
 * Unit tests for the pure command parsers exported from telegram/handlers.js.
 * (Stateful dispatch is exercised indirectly via the syncOrchestrator and
 * client tests; these checks pin down the user-visible command vocabulary.)
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isHelpCommand,
  isMenuCommand,
  isStartCommand,
  isStatusCommand,
} from "../src/telegram/handlers.js";

test("isStartCommand recognises /start with optional bot suffix and trailing args", () => {
  assert.equal(isStartCommand("/start"), true);
  assert.equal(isStartCommand("/start@PlaudExportBot"), true);
  assert.equal(isStartCommand("/start  hello"), true);
  assert.equal(isStartCommand("/started"), false);
  assert.equal(isStartCommand("hello /start"), false);
});

test("isHelpCommand / isMenuCommand / isStatusCommand match exactly", () => {
  assert.equal(isHelpCommand("/help"), true);
  assert.equal(isMenuCommand("/menu"), true);
  assert.equal(isStatusCommand("/status"), true);

  assert.equal(isHelpCommand("/helpme"), false);
  assert.equal(isMenuCommand("/menus"), false);
  assert.equal(isStatusCommand("/statu"), false);
});
