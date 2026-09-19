/**
 * Safe text replacement.
 *
 * Everything here exists to avoid breaking a live commerce site. We rewrite
 * text nodes only — never innerHTML — so event handlers, layout and framework
 * bindings survive untouched.
 *
 * Excluded: scripts, styles, code, form controls, contenteditable regions
 * (you type into 1688's chat box), and anything marked notranslate. Also
 * skipped: strings with no CJK, and pure numbers/prices/SKUs, because
 * translating those corrupts data rather than helping.
 */

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "KBD", "SAMP", "VAR",
  "SVG", "CANVAS", "TEXTAREA", "INPUT", "SELECT", "OPTION", "IFRAME",
  "MATH", "TEMPLATE",
]);

// <pre> is deliberately NOT skipped. 1688's chat renders every message bubble
// as `<pre class="edit" contenteditable="false">`, so excluding PRE silently
// skipped the entire conversation. The message input is a
// `<pre contenteditable="true">`, which the contenteditable rule below already
// protects, so nothing the user types is at risk.

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Text nodes we have already handled, so a re-render cannot loop. */
const handled = new WeakSet();

/** Original Chinese, so a translation can always be reverted. */
const originals = new Map();

/** True when the string contains Chinese and is worth translating. */
function needsTranslation(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 1) return false;
  if (!CJK.test(trimmed)) return false;
  // A string that is only digits, punctuation and CJK numerals is data, not prose.
  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(trimmed)) return false;
  return true;
}

/** Walk up from a node, returning false if any ancestor forbids translation. */
function isExcluded(node) {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute?.("translate") === "no") return true;
    if (el.classList?.contains("notranslate")) return true;
    // 1688 marks a lot of chrome this way; respect it.
    if (el.dataset?.noTranslate !== undefined) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Collect translatable text nodes under a root.
 * Returns an array of { node, text } with the original text attached.
 */
function collectNodes(root, { skipHandled = true } = {}) {
  const found = [];
  if (!root) return found;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (skipHandled && handled.has(node)) return NodeFilter.FILTER_REJECT;
        const value = node.nodeValue;
        if (!needsTranslation(value)) return NodeFilter.FILTER_REJECT;
        if (isExcluded(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let current;
  while ((current = walker.nextNode())) {
    found.push({ node: current, text: current.nodeValue });
  }
  return found;
}

/**
 * Replace a text node's content, preserving the original for later reverts.
 *
 * `nodeValue` (not `textContent`/`innerHTML`) is used deliberately: it fires
 * the smallest possible mutation and cannot destroy sibling elements.
 */
function applyTranslation(node, translation, original) {
  if (!node || typeof translation !== "string") return false;
  try {
    if (original !== undefined && !originals.has(node)) {
      originals.set(node, original);
    }
    node.nodeValue = translation;
    handled.add(node);
    return true;
  } catch {
    return false;
  }
}

/** Restore every translated node to its original text. */
function revertAll() {
  let count = 0;
  for (const [node, original] of originals) {
    try {
      node.nodeValue = original;
      count++;
    } catch {
      // The node is gone; nothing to restore.
    }
  }
  originals.clear();
  return count;
}

// Content scripts are concatenated into one isolated-world scope rather than
// loaded as modules, so export the pieces the other files need on a namespace.
// `isExcluded` and `SKIP_TAGS` are exported so tests can exercise the real
// filter rather than a copy of it — a duplicated rule set is how the PRE bug
// slipped through.
window.YKDReplace = {
  collectNodes,
  applyTranslation,
  needsTranslation,
  isExcluded,
  revertAll,
  SKIP_TAGS,
  handled,
  originals,
};
