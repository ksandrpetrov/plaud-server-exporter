import {
  BOT_HELP_HTML,
  BOT_UNKNOWN_COMMAND,
  parseTreeFilePickNumber,
} from "../messages.js";
import {
  extractCommandName,
  isHelpCommand,
  isMenuCommand,
  isStartCommand,
  isStatusCommand,
} from "../commandParsers.js";
import { safeSend } from "../botMessageUtils.js";
import { handleTreeFilePick } from "../treeBrowse.js";
import { handleStart, openMenu, sendStatusMessage } from "./menu.js";
import { guardAuthorizedPrivateUpdate } from "./privateUpdateGate.js";

export async function handleMessage(ctx, message) {
  const text = String(message?.text || "").trim();
  if (!text) return;
  const chatId = Number(message?.chat?.id);
  if (!Number.isInteger(chatId)) return;

  if (
    !guardAuthorizedPrivateUpdate(
      ctx,
      { chat: message.chat, from: message.from },
      {
        kind: "message",
        chatId,
        extra: { command: extractCommandName(text) },
      }
    )
  ) {
    return;
  }

  if (isStartCommand(text)) {
    await handleStart(ctx, {
      chatId,
      from: message.from,
    });
    return;
  }
  if (isHelpCommand(text)) {
    await safeSend(ctx, chatId, BOT_HELP_HTML);
    return;
  }
  if (isMenuCommand(text)) {
    await openMenu(ctx, chatId);
    return;
  }
  if (isStatusCommand(text)) {
    await sendStatusMessage(ctx, chatId);
    return;
  }

  const treePick = parseTreeFilePickNumber(text);
  if (treePick !== null) {
    await handleTreeFilePick(ctx, { chatId, pick: treePick });
    return;
  }

  await safeSend(ctx, chatId, BOT_UNKNOWN_COMMAND);
}
