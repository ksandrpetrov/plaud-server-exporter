import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PlaudAuthError } from "../src/plaud/errors.js";

const dir = await mkdtemp(join(tmpdir(), "plaud-sync-error-ui-"));
process.env.PLAUD_DATA_DIR = join(dir, ".data");
process.env.PLAUD_STATUS_PATH = join(dir, ".data", "status.json");
process.env.PLAUD_EXPORT_ROOT = join(dir, "exports");

const { handleSyncError } =
  await import("../src/telegram/sync/syncProgressPresenter.js");

test("handleSyncError persists auth failures to status.json", async () => {
  const telegram = {
    editMessageText: async () => ({}),
    sendMessage: async () => ({ message_id: 1 }),
  };
  const result = await handleSyncError({
    telegram,
    chatId: 1,
    messageId: 10,
    draftId: null,
    err: new PlaudAuthError("401 Unauthorized", 401),
    source: "manual",
    durationSec: 1,
    delivery: {
      isDraftMode: () => false,
      finish: async () => 10,
    },
    sleep: async () => {},
  });

  assert.equal(result.status, "auth_rejected");
  const payload = JSON.parse(
    await readFile(process.env.PLAUD_STATUS_PATH, "utf8")
  );
  assert.equal(payload.lastAuthError.message, "401 Unauthorized");
});
