import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { ERR_CALLBACK_HANDLER_TOAST } from "../src/telegram/messages/errors.js";

const dispatchSrc = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/telegram/handlers/dispatch.js"
  ),
  "utf8"
);

test("dispatch surfaces callback handler failures via alert toast", () => {
  assert.match(dispatchSrc, /ERR_CALLBACK_HANDLER_TOAST/);
  assert.match(dispatchSrc, /showAlert:\s*true/);
});

test("ERR_CALLBACK_HANDLER_TOAST is a non-empty user-facing string", () => {
  assert.ok(ERR_CALLBACK_HANDLER_TOAST.length > 10);
});
