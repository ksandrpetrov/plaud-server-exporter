import { redactError, redactString, redactValue } from "./security/redact.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const raw = String(process.env.PLAUD_LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] || LEVELS.info;
}

function format(level, message, meta) {
  const time = new Date().toISOString();
  const base = `${time} [${level.toUpperCase()}] ${redactString(String(message ?? ""))}`;
  if (meta == null) return base;
  try {
    return `${base} ${JSON.stringify(redactValue(meta))}`;
  } catch {
    return `${base} [unserializable meta]`;
  }
}

function emit(level, message, meta) {
  if (LEVELS[level] < currentLevel()) return;
  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${format(level, message, meta)}\n`);
}

export const logger = {
  debug: (msg, meta) => emit("debug", msg, meta),
  info: (msg, meta) => emit("info", msg, meta),
  warn: (msg, meta) => emit("warn", msg, meta),
  error: (msg, meta) => emit("error", msg, meta),
  errorFrom: (msg, err) => emit("error", msg, redactError(err)),
};
