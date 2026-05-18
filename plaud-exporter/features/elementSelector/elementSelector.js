// Import event handler functions for element selection from selectorUtils.js
import {
  elementSelectorClickHandler,
  elementSelectorHoverHandler,
  elementSelectorUnhoverHandler,
} from "./selectorUtils.js";

// Variable to track if the element selector mode is active
let isSelectorMode = false;
// Array to store selected element information
let selectedElements = [];

/**
 * Activates the Element Selector Mode.
 * Adds event listeners for click, hover, and unhover actions,
 * displays a visual indicator, and notifies the background script.
 */
export function startElementSelector() {
  if (isSelectorMode) return; // Prevent reactivation if already active
  isSelectorMode = true;
  console.log("Element Selector Mode activated");
  addSelectorIndicator();

  // Add event listeners with capturing enabled
  document.addEventListener("click", elementSelectorClickHandler, true);
  document.addEventListener("mouseover", elementSelectorHoverHandler, true);
  document.addEventListener("mouseout", elementSelectorUnhoverHandler, true);

  // Notify background script about the activation of selector mode
  chrome.runtime.sendMessage({
    action: "selectorModeStatus",
    isActive: true,
    message:
      "Element Selector Mode activated. Click on elements to select them.",
  });
}

/**
 * Deactivates the Element Selector Mode.
 * Removes event listeners and visual indicators,
 * resets any hover styling, and notifies the background script.
 */
export function stopElementSelector() {
  if (!isSelectorMode) return; // If not active, do nothing
  isSelectorMode = false;
  console.log("Element Selector Mode deactivated");
  removeSelectorIndicator();

  // Remove event listeners added during activation
  document.removeEventListener("click", elementSelectorClickHandler, true);
  document.removeEventListener("mouseover", elementSelectorHoverHandler, true);
  document.removeEventListener("mouseout", elementSelectorUnhoverHandler, true);

  // Remove hover styling from any elements that were highlighted
  const hoveredElements = document.querySelectorAll(
    ".element-selector-hovered"
  );
  hoveredElements.forEach((el) => {
    el.classList.remove("element-selector-hovered");
    el.style.outline = "";
  });

  // Notify background script about deactivation of selector mode
  chrome.runtime.sendMessage({
    action: "selectorModeStatus",
    isActive: false,
    message: "Element Selector Mode deactivated.",
  });
}

/**
 * Clears the array storing the selected element information.
 */
export function clearSelectedElements() {
  selectedElements = [];
}

/**
 * Returns a shallow copy of the selected elements array.
 *
 * @returns {Array} A copy of the selected elements.
 */
export function getSelectedElementsArray() {
  return selectedElements.slice();
}

/**
 * Creates and adds a visual indicator to the page to signal that Element Selector Mode is active.
 */
function addSelectorIndicator() {
  const indicator = document.createElement("div");
  indicator.id = "element-selector-indicator";
  // Inline CSS styling for the indicator element
  indicator.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        background-color: rgba(255, 87, 34, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 4px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        z-index: 9999;
        pointer-events: none;
      `;
  indicator.textContent =
    "Element Selector Mode: Click on elements to select them";
  document.body.appendChild(indicator);
}

/**
 * Removes the element selector visual indicator from the page, if present.
 */
function removeSelectorIndicator() {
  const indicator = document.getElementById("element-selector-indicator");
  if (indicator) {
    indicator.remove();
  }
}

// Export the selectedElements array for use in other modules if needed
export { selectedElements };
