/**
 * DOM fallback: автоматизация UI Plaud, когда прямой экспорт по API недоступен (только аудио).
 * Подключается из audioExport после неудачи API (без singleFile и без режима только саммари).
 */
import {
  clickElement,
  rightClickWithRetry,
  delay,
  findElementByXPath,
  waitForElement,
  waitForCondition,
} from "../../common/domUtils.js";
import { updateIndicator } from "../../common/uiComponents.js";
import {
  waitForDeleteMenuItem,
  findElementByText,
  resetDomState,
} from "./deleteHelpers.js";

function setupDownloadErrorListener() {
  window.downloadErrorOccurred = false;
  window.downloadErrorListener = function (event) {
    if (event.target.localName === "a" && event.type === "error") {
      console.error("Download error detected:", event);
      window.downloadErrorOccurred = true;
    }
  };
  document.addEventListener("error", window.downloadErrorListener, true);
  window.originalConsoleError = console.error;
  console.error = function () {
    for (let i = 0; i < arguments.length; i++) {
      const arg = String(arguments[i]);
      if (arg.includes("download") && arg.includes("error")) {
        window.downloadErrorOccurred = true;
        break;
      }
    }
    window.originalConsoleError.apply(console, arguments);
  };
}

function removeDownloadErrorListener() {
  if (window.downloadErrorListener) {
    document.removeEventListener("error", window.downloadErrorListener, true);
  }
  if (window.originalConsoleError) {
    console.error = window.originalConsoleError;
  }
}

function waitForDownloadResult() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (window.downloadErrorOccurred) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 500);
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 10000);
  });
}

/**
 * @param {object} ctx
 * @param {boolean} ctx.backgroundMode
 * @param {HTMLElement} ctx.indicator
 * @param {object} ctx.stats
 * @param {Set<string>} ctx.processedTitles
 * @param {() => Promise<boolean>} ctx.shouldStopExport
 * @param {(title: string, error?: boolean) => void} ctx.updateProgress
 */
export async function runDomExportFallback(ctx) {
  const {
    backgroundMode,
    indicator,
    stats,
    processedTitles,
    shouldStopExport,
    updateProgress,
  } = ctx;

  const maxErrors = 3;
  let fileCount = 0;
  let errorCount = 0;

  const fileInfoSelector = ".fileInfo";
  const fileTitleSelector = ".title";
  const shareIconXPath =
    '//*[@id="rightBox"]/div[2]/div[1]/span[1]/span[1]/div[1]/div[1]';
  const exportAudioOptionText = "Export Audio";
  const exportAudioOptionSelector = `li:contains("${exportAudioOptionText}"), [role="menuitem"]:contains("${exportAudioOptionText}")`;
  const mp3OptionText = "MP3";
  const exportButtonText = "Export";

  let scrollKeepVisibleIntervalId = null;
  function clearScrollKeepVisible() {
    if (scrollKeepVisibleIntervalId != null) {
      clearInterval(scrollKeepVisibleIntervalId);
      scrollKeepVisibleIntervalId = null;
    }
  }

  setupDownloadErrorListener();
  try {
    while (true) {
      if (await shouldStopExport()) {
        updateIndicator(
          indicator,
          `Экспорт остановлен после ${fileCount} файл(ов).`,
          "info"
        );
        console.log("Экспорт остановлен по запросу пользователя");
        return stats;
      }
      if (errorCount >= maxErrors) {
        updateIndicator(
          indicator,
          `Остановка после ${maxErrors} ошибок подряд.`,
          "error"
        );
        throw new Error(`Остановка после ${maxErrors} ошибок подряд.`);
      }

      let unprocessedFiles = [];
      try {
        await waitForCondition(
          () => {
            const allFiles = Array.from(
              document.querySelectorAll(fileInfoSelector)
            );
            unprocessedFiles = allFiles.filter((el) => {
              const titleEl = el.querySelector(fileTitleSelector);
              const titleText = titleEl ? titleEl.textContent.trim() : "";
              return titleText && !processedTitles.has(titleText);
            });
            return unprocessedFiles.length > 0;
          },
          10000,
          "поиск необработанных файлов"
        );
      } catch {
        if (fileCount === 0) {
          throw new Error(
            `Записи не найдены. Старый селектор (${fileInfoSelector}) не нашёл элементов на странице.`
          );
        }
        console.log(
          "Необработанных файлов не найдено — считаем экспорт завершённым."
        );
        unprocessedFiles = [];
      }

      console.log(`Осталось обработать файлов: ${unprocessedFiles.length}`);

      if (unprocessedFiles.length === 0) {
        updateIndicator(
          indicator,
          `Готово! Обработано файлов: ${fileCount}.`,
          "success"
        );
        console.log("Больше нет необработанных файлов. Готово.");
        stats.endTime = Date.now();
        stats.duration = stats.endTime - stats.startTime;
        setTimeout(() => indicator.remove(), 6000);
        return stats;
      }

      const fileElement = unprocessedFiles[0];
      const titleEl = fileElement.querySelector(fileTitleSelector);
      const fileTitle = titleEl ? titleEl.textContent.trim() : `(без названия)`;

      fileCount++;
      updateIndicator(indicator, `Экспорт файла №${fileCount}: ${fileTitle}…`);
      console.log(`Обработка: «${fileTitle}»…`);

      try {
        clearScrollKeepVisible();
        if (backgroundMode && document.visibilityState === "hidden") {
          console.log("Страница скрыта, экспорт в фоне продолжается");
          scrollKeepVisibleIntervalId = setInterval(() => {
            if (fileElement && document.body.contains(fileElement)) {
              fileElement.scrollIntoView({ behavior: "auto" });
            }
          }, 1000);
        }

        await clickElement(fileElement);
        const shareIcon = await findElementByXPath(shareIconXPath, 10000);
        if (!shareIcon)
          throw new Error("Не найден значок «Поделиться» после нажатия");

        await clickElement(shareIcon);
        const popoverSelector = '[id^="el-popover-"]';
        const popoverElement = await waitForElement(popoverSelector, 10000);
        let exportAudioOption = await findElementByText(
          exportAudioOptionText,
          "li",
          popoverElement
        );
        if (!exportAudioOption) {
          exportAudioOption = popoverElement.querySelector(
            exportAudioOptionSelector
          );
        }
        if (!exportAudioOption) {
          throw new Error(`В меню не найден пункт «${exportAudioOptionText}»`);
        }

        await clickElement(exportAudioOption);
        let mp3Option = await findElementByXPath(
          '//*[@id="rightBox"]/div[2]/div[1]/div[2]/div[1]/div[2]/div[1]/ul[1]/li[1]/div[2]',
          10000
        );
        if (!mp3Option) {
          mp3Option = await findElementByText(mp3OptionText, "div");
        }
        if (!mp3Option) throw new Error("Не найден вариант MP3");

        await clickElement(mp3Option);
        let exportButton = await findElementByXPath(
          '//*[@id="rightBox"]/div[2]/div[1]/div[2]/div[1]/div[2]/div[1]/div[3]',
          10000
        );
        if (!exportButton) {
          exportButton = await findElementByText(exportButtonText, "div");
        }
        if (!exportButton) {
          throw new Error("Не найдена кнопка экспорта");
        }

        window.downloadErrorOccurred = false;
        await clickElement(exportButton);
        await waitForDownloadResult();

        if (window.downloadErrorOccurred) {
          throw new Error("Скачивание не удалось — браузер сообщил об ошибке");
        }
        console.log("Скачивание для", fileTitle);
        await resetDomState();

        updateIndicator(
          indicator,
          `Удаление файла №${fileCount}: ${fileTitle}…`
        );
        console.log(`Beginning deletion for "${fileTitle}"...`);

        await rightClickWithRetry(fileElement, 3);

        const deleteItem = await waitForDeleteMenuItem(15000);
        if (!deleteItem) {
          throw new Error(`Не найден пункт «Удалить» для «${fileTitle}»`);
        }

        const initialFileCount =
          document.querySelectorAll(fileInfoSelector).length;
        await clickElement(deleteItem);

        try {
          await waitForCondition(
            () => {
              const currentFileCount =
                document.querySelectorAll(fileInfoSelector).length;
              const elementStillExists = document.body.contains(fileElement);
              return !elementStillExists || currentFileCount < initialFileCount;
            },
            10000,
            `ожидание удаления «${fileTitle}»`
          );
          console.log(`File "${fileTitle}" removed from DOM.`);
        } catch {
          console.warn(
            `File "${fileTitle}" might not have been removed automatically after delete click. Attempting manual removal.`
          );
          if (document.body.contains(fileElement)) {
            console.log(`Force-removing leftover item for: ${fileTitle}`);
            const liParent = fileElement.closest("li");
            if (liParent) {
              liParent.remove();
            } else {
              fileElement.remove();
            }
          }
        }

        await resetDomState();
        processedTitles.add(fileTitle);
        updateProgress(fileTitle);
        console.log(
          `File #${fileCount} ("${fileTitle}") exported & deleted successfully.`
        );
        errorCount = 0;
      } catch (error) {
        errorCount++;
        console.error(
          `File #${fileCount} ("${fileTitle}") failed:`,
          error.message,
          error.stack
        );
        updateIndicator(
          indicator,
          `Ошибка в файле №${fileCount}: ${error.message.substring(0, 50)}…`,
          "error"
        );
        updateProgress(fileTitle, true);

        try {
          await resetDomState();
        } catch (e) {
          console.warn("Не удалось сбросить интерфейс после ошибки:", e);
          document.body.click();
          await delay(500);
        }

        processedTitles.add(fileTitle);
        console.log("Переходим к следующему файлу после ошибки…");
      } finally {
        clearScrollKeepVisible();
      }
    }
  } finally {
    clearScrollKeepVisible();
    removeDownloadErrorListener();
  }
}
