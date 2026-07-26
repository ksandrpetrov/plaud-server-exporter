/**
 * Shared private-chat + allowed-sender gate for message and callback dispatch.
 * Failures are silent (log only) — foreign senders get no reply.
 */

import { logger } from "../../logger.js";
import {
  isAuthorizedPrivateUpdate,
  isPrivateChat,
  userIdFromPayload,
  usernameFromPayload,
} from "../auth.js";

/**
 * @param {{
 *   allowedUserId: number | null | undefined;
 *   allowedUsername: string | null | undefined;
 * } & Record<string, any>} ctx - Handler context with allowedUserId / allowedUsername
 * @param {{ chat: Record<string, any> | null | undefined; from: Record<string, any> | null | undefined }} payload
 * @param {{
 *   kind: "message" | "callback";
 *   chatId?: number;
 *   extra?: { data?: string; command?: string };
 * }} meta
 * @returns {boolean} true when the handler should proceed
 */
export function guardAuthorizedPrivateUpdate(ctx, payload, meta) {
  const chatId = meta.chatId ?? Number(payload.chat && payload.chat.id);

  if (!isPrivateChat(payload.chat)) {
    if (meta.kind === "callback") {
      logger.info("Silently ignored non-private callback", {
        chatType: String(payload.chat?.type || ""),
        chatId,
        data: meta.extra?.data,
      });
    } else {
      logger.info("Silently ignored non-private chat message", {
        chatType: String(payload.chat?.type || ""),
        chatId,
        username: usernameFromPayload(payload.from),
      });
    }
    return false;
  }

  if (!isAuthorizedPrivateUpdate(ctx, payload)) {
    if (meta.kind === "callback") {
      logger.info("Silently ignored callback from foreign sender", {
        userId: userIdFromPayload(payload.from),
        username: usernameFromPayload(payload.from),
        chatId,
        data: meta.extra?.data,
      });
    } else {
      logger.info("Silently ignored message from foreign sender", {
        userId: userIdFromPayload(payload.from),
        username: usernameFromPayload(payload.from),
        chatId,
        command: meta.extra?.command,
      });
    }
    return false;
  }

  return true;
}
