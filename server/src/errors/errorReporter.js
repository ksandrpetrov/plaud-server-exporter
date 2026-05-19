import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config, effectiveVaultRoot } from "../config/config.js";
import { logger } from "../logger.js";
import { redactError, redactString, redactValue } from "../security/redact.js";
import { classifyError } from "./errorClassifier.js";
import { hashStringSync } from "../../../plaud-exporter/common/syncCore.js";

function errorsDir() {
  return join(effectiveVaultRoot(), "_errors");
}

function formatTimestamp(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    fileStamp: `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}`,
  };
}

function buildDedupeKey(classified, context = {}) {
  return hashStringSync(
    `${classified.kind}|${classified.stage}|${classified.message}|${context.endpoint || ""}`
  );
}

async function findExistingReport(dedupeKey) {
  const dir = errorsDir();
  try {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(dir);
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      const text = await readFile(path, "utf8");
      if (text.includes(`dedupe_key: ${dedupeKey}`)) return path;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  return "";
}

/**
 * @param {unknown} error
 * @param {{
 *   stage?: string;
 *   runId?: string;
 *   endpoint?: string;
 *   httpStatus?: number;
 *   responseHint?: string;
 *   dryRun?: boolean;
 * }} [context]
 * @returns {Promise<{ path: string; classified: ReturnType<typeof classifyError>; skipped: boolean }>}
 */
export async function reportError(error, context = {}) {
  const classified = classifyError(error, context);
  const runId = context.runId || randomUUID();
  const redacted = redactError(error);
  const dedupeKey = buildDedupeKey(classified, context);

  if (context.dryRun) {
    logger.warn("Dry-run error (not written to _errors).", {
      ...classified,
      runId,
      dedupeKey,
    });
    return { path: "", classified, skipped: true };
  }

  const dir = errorsDir();
  await mkdir(dir, { recursive: true });

  const stableName = `plaud-export-error-${dedupeKey.slice(0, 16)}.md`;
  const stablePath = join(dir, stableName);
  try {
    const existingText = await readFile(stablePath, "utf8");
    if (existingText.includes(`dedupe_key: ${dedupeKey}`)) {
      logger.warn("Error report already exists for this failure; skipping duplicate.", {
        path: stablePath,
        kind: classified.kind,
      });
      return { path: stablePath, classified, skipped: true };
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }

  const existing = await findExistingReport(dedupeKey);
  if (existing) {
    logger.warn("Error report already exists for this failure; skipping duplicate.", {
      path: existing,
      kind: classified.kind,
    });
    return { path: existing, classified, skipped: true };
  }

  const { date, time, fileStamp } = formatTimestamp();
  const filename = `${fileStamp}-${stableName}`;
  const absolutePath = join(dir, filename);

  const body = [
    "# Plaud export error",
    "",
    `Дата: ${date} ${time}`,
    `Run ID: ${runId}`,
    `Stage: ${classified.stage}`,
    `Severity: ${classified.severity}`,
    `Kind: ${classified.kind}`,
    `dedupe_key: ${dedupeKey}`,
    "",
    "## Что случилось",
    "",
    redactString(classified.message),
    "",
    "## Технические детали",
    "",
    `- endpoint/action: ${redactString(context.endpoint || "n/a")}`,
    classified.httpStatus || context.httpStatus
      ? `- HTTP status: ${classified.httpStatus || context.httpStatus}`
      : "- HTTP status: n/a",
    context.responseHint
      ? `- response hint: ${redactString(context.responseHint)}`
      : "",
    `- error: ${redacted.message}`,
    redacted.stack ? `- stack:\n\n\`\`\`\n${redacted.stack}\n\`\`\`` : "",
    "",
    "## Что сделать",
    "",
    classified.kind === "auth_error"
      ? "- Проверить авторизацию и выполнить `npm run server:auth`."
      : "- Проверить авторизацию Plaud.",
    classified.kind === "plaud_changed"
      ? "- Plaud, вероятно, изменил API — нужен ручной аудит экспортера."
      : "- Если проблема повторяется, открыть логи сервера.",
    "- Обновить Plaud session при необходимости.",
    "",
    classified.needsManualReview
      ? "> **Требуется ручная проверка** — классифицировано как изменение Plaud."
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const tmp = `${absolutePath}.tmp-${process.pid}`;
  await writeFile(tmp, `${body}\n`, "utf8");
  await rename(tmp, absolutePath);

  logger.error("Wrote Plaud export error report.", {
    path: absolutePath,
    kind: classified.kind,
    stage: classified.stage,
    details: redactValue({ message: classified.message }),
  });

  return { path: absolutePath, classified, skipped: false };
}

export async function errorsDirectoryInfo() {
  const dir = errorsDir();
  try {
    const s = await stat(dir);
    return { exists: true, path: dir, isDirectory: s.isDirectory() };
  } catch (err) {
    if (err?.code === "ENOENT") return { exists: false, path: dir };
    throw err;
  }
}
