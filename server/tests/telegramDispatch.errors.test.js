import assert from "node:assert/strict";
import test from "node:test";
import { dispatchUpdate } from "../src/telegram/handlers/dispatch.js";
import { CB_RUN_SYNC } from "../src/telegram/callbackData.js";
import { ERR_CALLBACK_HANDLER_TOAST } from "../src/telegram/messages/errors.js";

for (const answerFails of [false, true]) {
  test(`callback failure alerts the owner; answer failure=${answerFails}`, async () => {
    const calls = [];
    const id = answerFails ? 901 : 902;
    await dispatchUpdate(
      {
        allowedUserId: id,
        allowedUsername: "owner",
        runManualSync: async () => {
          throw new Error("sync failed");
        },
        telegram: {
          answerCallbackQuery: async (args) => {
            calls.push(args);
            if (answerFails) throw new Error("network unavailable");
          },
        },
      },
      {
        callback_query: {
          id: "callback-1",
          data: CB_RUN_SYNC,
          from: { id, username: "owner" },
          message: { message_id: 1, chat: { id, type: "private" } },
        },
      }
    );
    assert.deepEqual(calls, [
      {
        callbackQueryId: "callback-1",
        text: ERR_CALLBACK_HANDLER_TOAST,
        show_alert: true,
      },
    ]);
  });
}
