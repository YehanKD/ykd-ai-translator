/**
 * Finding a chat composer on the page, and putting text into it.
 *
 * Split out from the pebble UI so the fiddly part — locating the right
 * editable and making the site's own framework notice the change — stays
 * testable without a browser.
 *
 * Writing to a contenteditable is the step that usually breaks: assigning
 * `.textContent` updates the DOM but the site's framework never sees an input
 * event, so the send button stays disabled and the message goes out empty.
 * `execCommand("insertText")` drives the browser's own editing pipeline, which
 * fires a real `beforeinput`/`input` with `inputType: "insertText"` — verified
 * against 1688: it updated the site's own character counter (17 / 500) and
 * dropped the `send-btn--empty` modifier from the send button.
 */

/** Editable candidates, most specific first. */
const COMPOSER_SELECTORS = [
  'pre.edit[contenteditable="true"]',        // 1688 seller chat
  '.send-box [contenteditable="true"]',      // 1688 chat shell
  '.text-panel [contenteditable="true"]',
  '[contenteditable="true"][role="textbox"]',
  '.chat-input[contenteditable="true"]',
  'div[contenteditable="true"]',
  "textarea",
];

/**
 * A composer is a wide, short box. These minimums filter out search fields,
 * icon holders and other small editables that are not for writing messages.
 */
const MIN_WIDTH = 120;
const MIN_HEIGHT = 16;

/** Visible, on screen, and big enough to be a composer. */
function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number(style.opacity) === 0) return false;
  return true;
}

/** Bigger boxes win; ties break by document order. */
function scoreComposer(el) {
  const rect = el.getBoundingClientRect();
  return rect.width * rect.height;
}

/**
 * The best visible composer on this document, or null.
 *
 * `<input>` elements are deliberately never considered: a site's contact
 * search box is an `<input>`, and typing a supplier message into it would be
 * worse than showing no button at all.
 */
function findComposer() {
  for (const selector of COMPOSER_SELECTORS) {
    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll(selector)) {
      if (el.tagName === "INPUT") continue;
      if (el.disabled || el.readOnly) continue;
      if (!isVisible(el)) continue;
      const score = scoreComposer(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    if (best) return best;
  }
  return null;
}

function hasComposer() {
  return findComposer() !== null;
}

/**
 * Put `text` into the composer, replacing whatever is already there.
 *
 * Replacing rather than appending is deliberate: the pebble is the input
 * surface, so the message box should end up holding exactly the translated
 * message and nothing else.
 */
function insertIntoComposer(el, text) {
  if (!el || typeof text !== "string") return false;

  try {
    el.focus();
  } catch {
    // Focus is best-effort; execCommand still works in most cases without it.
  }

  if (el.isContentEditable) {
    // Selecting the existing content makes insertText replace it in one step.
    if ((el.textContent || "").length > 0) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // Selection is an optimisation; fall through to a plain insert.
      }
    }

    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }

    if (!ok) {
      // Anything that blocks execCommand still gets the text, plus the event
      // the framework listens for.
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }),
      );
    }
    return true;
  }

  // textarea / input fallback for other sites.
  el.value = text;
  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }),
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// Content scripts share one isolated-world scope, so publish the API.
window.YKDCompose = {
  findComposer,
  hasComposer,
  insertIntoComposer,
  isVisible,
  COMPOSER_SELECTORS,
};
