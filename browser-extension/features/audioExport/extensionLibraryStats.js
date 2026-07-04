/**
 * features/audioExport/extensionLibraryStats.js
 * Library stats (recordings / summaries count) for popup.
 */
import { findSummaryNotes } from "../../common/plaudSummaries.js";
import { PLAUD_FOLDER_UNFILED } from "../../common/plaudFolders.js";
import {
  countLikelySummariesFromFileMetadata,
  countRecordingTrashSignals,
  fetchPlaudApi,
  fetchPlaudFilesFromApi,
} from "./plaudBrowserApi.js";
import { getPlaudSession } from "./plaudBrowserSession.js";
import {
  mergeDomRecordingIdsIntoFiles,
  mergeLocalStorageRecordingIdsIntoFiles,
} from "./plaudRecordingIdScraper.js";

/**
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 * @template T
 */
function withTimeout(promise, ms, message) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

/**
 * Подсчёт записей и (опционально) саммари-заметок в текущем workspace Plaud Web.
 * Саммари считаются как элементы {@link findSummaryNotes} без загрузки внешних data_link.
 *
 * @param {{
 *   includeSummaries?: boolean;
 *   timeoutMs?: number;
 *   onProgress?: (p: { phase: "list" | "summaries"; current: number; total: number }) => void;
 * }} [options]
 * @returns {Promise<{ recordings: number; summaries: number; libraryStatsNote?: { countExplanation?: string } }>}
 */
export async function runLibraryStats(options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const includeSummaries = options.includeSummaries === true;
  const summaryTimeoutMs = Number(options.timeoutMs);
  const summaryTimeout =
    Number.isFinite(summaryTimeoutMs) && summaryTimeoutMs > 0
      ? summaryTimeoutMs
      : 180000;

  async function compute() {
    const session = await getPlaudSession();

    onProgress?.({ phase: "list", current: 0, total: 1 });
    let files = await fetchPlaudFilesFromApi(session);
    mergeDomRecordingIdsIntoFiles(files, {
      unfiledLabel: PLAUD_FOLDER_UNFILED,
    });
    mergeLocalStorageRecordingIdsIntoFiles(files);

    const recordings = files.length;
    const trashSignals = countRecordingTrashSignals(files);
    const sumLiveTrash = trashSignals.likelyLive + trashSignals.trashy;
    const countExplainsSidebarGap =
      trashSignals.unclear === 0 &&
      recordings === sumLiveTrash &&
      trashSignals.likelyLive > 0;
    const countExplanation = countExplainsSidebarGap
      ? `По API: ${trashSignals.likelyLive} активных + ${trashSignals.trashy} в корзине = ${recordings} уникальных записей. Сумма «Все файлы + Unfiled + Корзина» в сайдбаре Plaud часто больше: Unfiled — часть «Все файлы», строки не суммируются.`
      : "";

    const libraryStatsNote = countExplanation
      ? { countExplanation }
      : undefined;
    onProgress?.({ phase: "list", current: 1, total: 1 });

    const summariesFromListMeta = countLikelySummariesFromFileMetadata(files);

    if (!includeSummaries) {
      return {
        recordings,
        summaries: summariesFromListMeta,
        libraryStatsNote,
      };
    }

    let summaries = 0;
    const concurrency = 4;
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i += concurrency) {
      const chunk = files.slice(i, i + concurrency);
      const counts = await Promise.all(
        chunk.map(async (file) => {
          try {
            const payload = await fetchPlaudApi(session, "/ai/query_note", {
              headers: { "file-id": file.id },
            });
            return findSummaryNotes(payload).length;
          } catch {
            return 0;
          }
        })
      );
      summaries += counts.reduce((a, b) => a + b, 0);
      onProgress?.({
        phase: "summaries",
        current: Math.min(i + chunk.length, totalFiles),
        total: totalFiles,
      });
    }

    return { recordings, summaries, libraryStatsNote };
  }

  if (includeSummaries) {
    return withTimeout(
      compute(),
      summaryTimeout,
      "Подсчёт саммари занял слишком много времени. Попробуйте позже или откройте Plaud на более простой странице."
    );
  }

  return compute();
}
