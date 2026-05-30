/**
 * Command + callback routing for the Telegram bot.
 *
 * Stays close to satellite's `handlers.py` design:
 *
 * - `/start` and `/help` answer everyone with a polite "this is private" hint
 *   so accidental tappers don't see silence.
 * - Every other message/callback from a non-owner is silently ignored
 *   (only logged) — same pattern as `USER_CALENDAR_MAP` gate in satellite.
 * - The first authorized `/start` writes `owner-chat.json` so the scheduler
 *   knows where to post unsolicited "scheduled sync" updates.
 * - Inline buttons always `editMessageText` on the same message; we never
 *   fall back to `sendMessage` from a callback handler, otherwise duplicate
 *   callbacks (Telegram retries) would spam the chat.
 */

export { dispatchUpdate } from "./handlers/dispatch.js";
export {
  isHelpCommand,
  isMenuCommand,
  isStartCommand,
  isStatusCommand,
} from "./commandParsers.js";

import { loadOwnerChat } from "./ownerChat.js";

export async function ownerChatId() {
  const record = await loadOwnerChat();
  return record?.chatId ?? null;
}
