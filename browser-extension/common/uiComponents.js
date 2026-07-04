/**
 * Creates a status indicator element to display messages on the page.
 * The indicator is styled and fixed at the top-right corner.
 *
 * @returns {HTMLElement} The status indicator element.
 */
export function createStatusIndicator() {
  // Create a new div element to serve as the indicator.
  const indicator = document.createElement("div");
  // Apply inline CSS styles for positioning, appearance, and visibility.
  indicator.style.cssText = `
        position: fixed;
        top: 16px;
        right: 16px;
        max-width: min(360px, calc(100vw - 32px));
        background-color: rgba(23, 32, 46, 0.94);
        color: white;
        padding: 12px 14px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
        letter-spacing: 0;
        z-index: 2147483647;
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.28);
        pointer-events: none;
      `;
  // Append the indicator to the document body so it's visible.
  document.body.appendChild(indicator);
  return indicator;
}

/**
 * Updates the status indicator with a new message and visual style.
 *
 * @param {HTMLElement} indicator - The status indicator element.
 * @param {string} message - The message to display.
 * @param {string} [type="info"] - The type of message ("info", "success", "error").
 */
export function updateIndicator(indicator, message, type = "info") {
  // Update the text content of the indicator.
  indicator.textContent = message;
  // Update the background color based on the message type.
  switch (type) {
    case "success":
      indicator.style.backgroundColor = "rgba(20, 128, 94, 0.94)";
      break;
    case "error":
      indicator.style.backgroundColor = "rgba(194, 65, 45, 0.94)";
      break;
    default:
      indicator.style.backgroundColor = "rgba(23, 32, 46, 0.94)";
  }
}
