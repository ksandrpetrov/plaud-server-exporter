/**
 * features/elementSelector/selectorUtils.js
 * No critical workflow delays here. The setTimeout is for visual feedback removal.
 */
import { selectedElements } from "./elementSelector.js";

/**
 * Handles the click event during element selector mode.
 * Provides visual feedback using styles and a setTimeout for cleanup.
 *
 * @param {Event} event - The click event triggered on the page.
 */
export function elementSelectorClickHandler(event) {
  event.preventDefault();
  event.stopPropagation();

  const element = event.target;
  const elementInfo = {
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    innerText: element.innerText
      ? element.innerText.substring(0, 100) +
        (element.innerText.length > 100 ? "..." : "")
      : "",
    xPath: getXPathForElement(element),
    cssSelector: getCssSelector(element),
    attributes: getElementAttributes(element),
    outerHTML:
      element.outerHTML.substring(0, 300) +
      (element.outerHTML.length > 300 ? "..." : ""),
  };

  selectedElements.push(elementInfo);

  // Visual feedback
  const originalOutline = element.style.outline; // Store original outline
  const originalTransition = element.style.transition;
  element.style.transition = "outline 0.3s ease-out"; // Add transition for smooth removal
  element.style.outline = "3px solid rgba(76, 175, 80, 0.8)";

  // Remove the outline after 1 second using setTimeout (acceptable for non-blocking visual feedback)
  setTimeout(() => {
    element.style.outline = originalOutline; // Restore original or empty outline
    element.style.transition = originalTransition;
  }, 1000);

  // Send the element info to the background script.
  chrome.runtime.sendMessage({
    action: "elementSelected",
    elementInfo,
    index: selectedElements.length - 1,
  });
  console.log("Element selected:", elementInfo);
}

// --- Other functions (hover handlers, attribute/XPath/CSS getters) remain the same ---

/** Handles mouseover events for visual cue. */
export function elementSelectorHoverHandler(event) {
  const element = event.target;
  // Check if the element already has the click-highlight style to avoid overriding it immediately
  if (!element.style.outline.includes("rgb(76, 175, 80)")) {
    element.classList.add("element-selector-hovered");
    element.dataset.originalOutline = element.style.outline; // Store outline
    element.style.outline = "2px dashed rgba(33, 150, 243, 0.7)";
  }
}

/** Handles mouseout events to remove hover cue. */
export function elementSelectorUnhoverHandler(event) {
  const element = event.target;
  // Only remove hover style if it wasn't the clicked-highlight style
  if (element.classList.contains("element-selector-hovered")) {
    element.classList.remove("element-selector-hovered");
    element.style.outline = element.dataset.originalOutline || ""; // Restore original outline
    delete element.dataset.originalOutline; // Clean up dataset property
  }
}

/** Retrieves all attributes of a given element. */
export function getElementAttributes(element) {
  const attributes = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    attributes[attr.name] = attr.value;
  }
  return attributes;
}

/** Computes an XPath string for the element. */
export function getXPathForElement(element) {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  if (element === document.body) {
    return "/html/body";
  }
  let ix = 0;
  const siblings = element.parentNode.childNodes;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      // Construct XPath using lowercase tagName and 1-based index
      return `${getXPathForElement(
        element.parentNode
      )}/${element.tagName.toLowerCase()}[${ix + 1}]`;
    }
    // Count only element nodes of the same tag type
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
  // Fallback or should not happen for valid elements within the body
  return "";
}

/** Constructs a CSS selector string for the element. */
export function getCssSelector(element) {
  if (!element || !(element instanceof Element)) {
    return "";
  }
  if (element.id) {
    // Escape the ID for CSS selector
    const escapedId = element.id.replace(/([^\w-])/g, "\\$1");
    return `#${escapedId}`;
  }
  const path = [];
  while (element.nodeType === Node.ELEMENT_NODE) {
    let selector = element.nodeName.toLowerCase();
    if (element.id) {
      const escapedId = element.id.replace(/([^\w-])/g, "\\$1");
      selector += `#${escapedId}`;
      path.unshift(selector);
      break; // ID is unique, stop traversing
    } else {
      let sibling = element;
      let nth = 1;
      // Count previous siblings of the same type
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.nodeName.toLowerCase() === selector) nth++;
      }
      // Add :nth-of-type only if necessary
      if (
        nth !== 1 ||
        element.parentElement?.querySelectorAll(
          `${selector}:nth-of-type(${nth})`
        ).length > 1
      ) {
        // Check if the element is the only one of its type or if nth-of-type is needed
        const parent = element.parentElement;
        if (parent) {
          const siblingsOfType = Array.from(parent.children).filter(
            (child) => child.nodeName.toLowerCase() === selector
          );
          if (siblingsOfType.length > 1) {
            selector += `:nth-of-type(${nth})`;
          }
        } else if (nth !== 1) {
          // Fallback if parent is null (shouldn't happen often)
          selector += `:nth-of-type(${nth})`;
        }
      }
    }
    path.unshift(selector);
    // Stop at body or if parentNode is not an element
    if (
      element.parentNode === document.body ||
      !(element.parentNode instanceof Element)
    )
      break;
    element = element.parentNode;
  }
  // Prepend html if the path doesn't start with body or html
  if (
    path.length > 0 &&
    !path[0].startsWith("html") &&
    !path[0].startsWith("body")
  ) {
    path.unshift("body"); // Assume it's within body if not html
  }
  if (path.length > 0 && !path[0].startsWith("html")) {
    path.unshift("html");
  }

  return path.join(" > ");
}
