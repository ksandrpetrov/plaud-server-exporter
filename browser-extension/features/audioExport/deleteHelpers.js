/**
 * features/audioExport/deleteHelpers.js
 */
import { delay } from "../../common/domUtils.js";

/**
 * Polls for up to `maxWaitMs` milliseconds to locate a menu item with text "Delete".
 * Uses multiple selector strategies and fallbacks.
 * This function already implements dynamic waiting via polling.
 *
 * @param {number} [maxWaitMs=15000] - Maximum wait time in milliseconds.
 * @returns {Promise<Element>} - The found delete menu item.
 * @throws {Error} - If the "Delete" menu item is not found within the time limit.
 */
export async function waitForDeleteMenuItem(maxWaitMs = 15000) {
  const pollInterval = 250;
  let waited = 0;
  const menuSelectors = [
    ".context-menu .menu-item",
    ".dropdown-menu .menu-item",
    "[role='menu'] [role='menuitem']",
  ];
  const fallbackSelectors = ["div", "span", "li", "button"]; // For broader search later
  const deleteTexts = ["Delete", "Delete file", "Delete item"]; // Possible texts

  // Optional short delay allows UI triggered by previous action (e.g., right-click) to potentially settle.
  // Could be removed if rightClickWithRetry handles waiting sufficiently.
  await delay(100);

  console.log(`Waiting for delete menu item... (timeout: ${maxWaitMs}ms)`);

  while (waited < maxWaitMs) {
    // Try primary selectors first
    for (const selector of menuSelectors) {
      const menuItems = document.querySelectorAll(selector);
      for (const item of menuItems) {
        const text = (item.textContent || "").trim();
        if (deleteTexts.some((delText) => text.includes(delText))) {
          console.log(
            `Found delete menu item via primary selector after ${waited}ms`
          );
          return item;
        }
      }
    }

    // After 5 seconds, broaden the search as a fallback
    if (waited > 5000) {
      for (const selector of fallbackSelectors) {
        const allElements = document.querySelectorAll(selector);
        for (const el of allElements) {
          const text = (el.textContent || "").trim();
          if (deleteTexts.includes(text)) {
            console.log(`Found delete via fallback selector after ${waited}ms`);
            return el;
          }
        }
      }
    }

    // Wait before the next poll interval
    await delay(pollInterval);
    waited += pollInterval;
  }

  throw new Error(
    `Превышено время ожидания пункта «Удалить» в меню (${maxWaitMs} мс).`
  );
}

/**
 * Finds an element that contains the specified text within a given parent element or the whole document.
 *
 * @param {string} text - Text to search for (case-sensitive, partial match).
 * @param {string} [tagName="*"] - Tag name to filter elements.
 * @param {Element} [parentElement=document] - Element within which to search.
 * @returns {Promise<Element|null>} - The found element or null if not found.
 */
export async function findElementByText(
  text,
  tagName = "*",
  parentElement = document
) {
  // This function is synchronous currently, but making it async allows for future enhancements (e.g., adding waits)
  const elements = parentElement.querySelectorAll(tagName);
  for (const el of elements) {
    const trimmed = (el.textContent || "").trim();
    if (trimmed.includes(text)) {
      return el;
    }
  }
  return null;
}

/**
 * Resets the DOM state to dismiss any lingering menus or UI elements.
 * Improves the reliability of subsequent operations.
 * Removed the fixed delay.
 */
export async function resetDomState() {
  console.log("Сброс состояния интерфейса…");
  // Attempt to click on a neutral area (header or document body) to dismiss any open menus.
  const safeClickArea = document.querySelector("header") || document.body;

  try {
    // Use a simple click first
    safeClickArea.click();
  } catch (error) {
    console.warn("Простой клик не сработал, пробуем событие:", error.message);
    // Fallback to event dispatch
    try {
      const evt = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      safeClickArea.dispatchEvent(evt);
    } catch (dispatchError) {
      console.error(
        "Событие для безопасного клика тоже не сработало:",
        dispatchError
      );
    }
  }

  // Scroll slightly to refresh any virtual scroller state.
  window.scrollBy(0, 1);
  window.scrollBy(0, -1);

  // Instead of fixed delay, maybe wait briefly for any potential menu to disappear?
  // Or rely on the next action's waitForElement. For now, removing the delay.
  // await delay(100); // Optional tiny delay if needed.
  console.log("Сброс интерфейса выполнен.");
}
