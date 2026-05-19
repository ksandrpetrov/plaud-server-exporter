import assert from "node:assert/strict";
import test from "node:test";
import { redactError, redactString } from "../src/security/redact.js";

/** Obviously fake token; must match TELEGRAM_BOT_TOKEN_RE in redact.js */
const FAKE_TELEGRAM_TOKEN =
  "123456789:FAKE_UNIT_TEST_TELEGRAM_TOKEN_abcdefghijklmnop";

test("redactString masks raw Telegram bot tokens", () => {
  const sample = `telegram login failed for bot ${FAKE_TELEGRAM_TOKEN}`;
  const out = redactString(sample);
  assert.match(out, /\[REDACTED_TELEGRAM_TOKEN\]/);
  assert.doesNotMatch(out, /FAKE_UNIT_TEST_TELEGRAM_TOKEN/);
  assert.doesNotMatch(out, /123456789:AA/);
});

test("redactString masks Telegram tokens embedded in api.telegram.org URLs", () => {
  const sample = `POST https://api.telegram.org/bot${FAKE_TELEGRAM_TOKEN}/sendMessage`;
  const out = redactString(sample);
  assert.match(out, /api\.telegram\.org\/bot\[REDACTED_TELEGRAM_TOKEN\]/);
  assert.doesNotMatch(out, /FAKE_UNIT_TEST_TELEGRAM_TOKEN/);
});

test("redactError sanitises a Telegram token leaked into Error.message", () => {
  const err = new Error(
    `fetch failed for https://api.telegram.org/bot${FAKE_TELEGRAM_TOKEN}/getMe`
  );
  const safe = redactError(err);
  assert.doesNotMatch(safe.message, /FAKE_UNIT_TEST_TELEGRAM_TOKEN/);
  assert.match(safe.message, /\[REDACTED_TELEGRAM_TOKEN\]/);
});
