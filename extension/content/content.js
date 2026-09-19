/**
 * Content script: find Chinese on the page, translate it, replace it in place.
 *
 * Strategy:
 *   1. Collect translatable text nodes.
 *   2. Translate what is visible first, then follow as the user scrolls.
 *   3. Watch for re-renders (1688 is an SPA and the seller chat updates live),
 *      debounced so we never translate our own writes.
 *
 * The service worker does the actual requests, so this file never touches the
 * network and stays cheap.
 */

(() => {
  "use strict";

  const { collectNodes, applyTranslation, needsTranslation, revertAll } =
    window.YKDReplace;

  const TARGET = "English";
  const DEBOUNCE_MS = 400;
  const SCROLL_IDLE_MS = 250;
  const MAX_CONCURRENT = 2;

  /** Currency preference, refreshed from the service worker on demand. */
  const money = {
    currency: null,
    enabled: true,
    roundWhole: true,
    rates: null,
    base: "CNY",
    decimals: 2,
    loaded: false,
  };

  /** Nodes waiting to be translated, visible ones first. */
  let queue = [];
  let inFlight = 0;
  let enabled = true;
  let connected = false;
  let scrollTimer = null;
  let mutationTimer = null;
  let stopped = false;

  const stats = { queued: 0, translated: 0, converted: 0 };

  // ---------------------------------------------------------------- helpers

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (reply) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(reply ?? { ok: false });
        }
      });
    });
  }

  function isVisible(node) {
    const el = node.parentElement;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return (
      rect.bottom >= -200 &&
      rect.top <= (window.innerHeight || 0) + 200
    );
  }

  // ---------------------------------------------------------------- currency

  /**
   * Load the currency preference and rates once per page.
   *
   * Conversion is opt-in per user setting, and needs both a chosen currency and
   * a rate for it — without either, prices are left exactly as the page wrote
   * them rather than showing a guessed number.
   */
  async function loadCurrency(force = false) {
    try {
      const reply = await send("currencyInfo", { force });
      if (!reply?.ok) return;
      money.currency = reply.currency ?? null;
      money.enabled = reply.convertPrices !== false;
      money.roundWhole = reply.roundWhole !== false;
      money.rates = reply.rates ?? null;
      money.base = reply.base ?? "CNY";
      const meta = window.YKDCurrency?.findCurrency(money.currency);
      money.decimals = meta?.decimals ?? 2;
      money.loaded = true;
    } catch {
      // Leave conversion off; translation still works.
    }
  }

  function conversionActive() {
    return Boolean(
      money.loaded &&
      money.enabled &&
      money.currency &&
      money.rates &&
      money.rates[money.currency],
    );
  }

  /**
   * True when a node is inside a text-entry area.
   *
   * Never convert inside something the user is typing into: replacing a price
   * mid-sentence would be destructive, and the composer is not ours to rewrite.
   */
  function isEditable(node) {
    let el = node.parentElement;
    while (el) {
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      el = el.parentElement;
    }
    return false;
  }

  /**
   * Rewrite the prices in one text node.
   * Returns true when the text changed.
   */
  function convertNode(node) {
    if (!conversionActive()) return false;
    if (!node?.nodeValue) return false;
    if (isEditable(node)) return false;

    const result = window.YKDPrice.convertPrices(
      node.nodeValue,
      { rates: money.rates },
      money.currency,
      { whole: money.roundWhole, decimals: money.decimals },
    );
    if (!result.changed) return false;

    node.nodeValue = result.text;
    return true;
  }

  /**
   * Rewrite prices that 1688 splits across sibling spans
   * (`<span class="symbol">¥</span><span class="number">14</span>…`).
   * The per-node pass cannot see those, because no single text node holds a
   * whole price.
   */
  function convertGrouped(root) {
    if (!conversionActive()) return 0;
    let changed = 0;
    try {
      for (const item of window.YKDPrice.findGroupedPrices(root)) {
        if (convertGroupedEl(item.el)) changed++;
      }
    } catch {
      // A malformed subtree must not stop translation.
    }
    return changed;
  }

  /** Convert one already-identified grouped price. */
  function convertGroupedEl(el) {
    const ok = window.YKDPrice.convertGroupedPrice(
      el,
      { rates: money.rates },
      money.currency,
      { whole: money.roundWhole, decimals: money.decimals },
    );
    if (ok) {
      // The node was rewritten wholesale, so mark every descendant as handled
      // to keep the translator from picking up our own output.
      try {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = walker.nextNode())) window.YKDReplace.handled.add(t);
      } catch {
        // Non-fatal.
      }
    }
    return ok;
  }

  // ------------------------------------------------------------- collection

  /** Scan the document (or a subtree) and add new nodes to the queue. */
  function enqueue(root = document.body) {
    if (!enabled || stopped || !root) return;

    // Prices first: a node with a price but no Chinese would never reach the
    // translate path, so it has to be converted here or not at all.
    if (conversionActive()) {
      try {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = walker.nextNode())) {
          convertNode(t);
        }
      } catch {
        // A malformed subtree must not stop translation.
      }
      stats.converted += convertGrouped(root);
    }

    const found = collectNodes(root);
    if (found.length === 0) return;

    // Visible nodes jump the queue so the user sees results immediately.
    const visible = [];
    const rest = [];
    for (const item of found) {
      (isVisible(item.node) ? visible : rest).push(item);
    }
    queue = visible.concat(queue, rest);
    stats.queued = queue.length;
    pump();
  }

  /** Take the next chunk of work, avoiding duplicate source strings. */
  function takeChunk(max = 25) {
    const chunk = [];
    const seen = new Set();
    const remaining = [];

    for (const item of queue) {
      if (chunk.length >= max) {
        remaining.push(item);
        continue;
      }
      if (seen.has(item.text)) {
        remaining.push(item);
        continue;
      }
      if (!needsTranslation(item.text)) continue;   // stale entry
      seen.add(item.text);
      chunk.push(item);
    }
    queue = remaining;
    return chunk;
  }

  async function pump() {
    if (!enabled || stopped) return;
    if (inFlight >= MAX_CONCURRENT) return;
    if (queue.length === 0) return;

    const chunk = takeChunk();
    if (chunk.length === 0) return;

    inFlight++;
    try {
      const reply = await send("translate", {
        texts: chunk.map((c) => c.text),
        target: TARGET,
      });

      if (!reply?.ok) {
        setConnected(false);
        if (reply?.error) console.debug("[YKD]", reply.error);
        // Put the work back so a later reconnect can pick it up.
        queue = chunk.concat(queue);
        return;
      }

      setConnected(true);
      const translations = reply.translations ?? [];

      // Several nodes can share one source string; translate once, apply to all.
      const valueByText = new Map();
      chunk.forEach((item, i) => {
        const value = translations[i];
        if (value && !valueByText.has(item.text)) {
          valueByText.set(item.text, value);
        }
      });

      let applied = 0;
      for (const item of chunk) {
        const value = valueByText.get(item.text);
        if (!value) continue;
        if (!item.node.isConnected) continue;
        if (applyTranslation(item.node, value, item.text)) applied++;
      }
      stats.translated += applied;

      // Prices: the translated English may contain ¥ amounts the original did
      // not (or vice versa), so conversion runs after translation, on the node's
      // current text.
      for (const item of chunk) {
        if (!item.node.isConnected) continue;
        if (convertNode(item.node)) stats.converted++;
      }
    } catch (err) {
      console.debug("[YKD] translate failed:", err);
      setConnected(false);
      queue = chunk.concat(queue);
    } finally {
      inFlight--;
      stats.queued = queue.length;
      if (queue.length > 0 && enabled) {
        // Keep going, but yield so the page stays responsive.
        setTimeout(pump, 0);
      }
    }
  }

  // -------------------------------------------------------------- connection

  function setConnected(value) {
    if (connected === value) return;
    connected = value;
    if (connected) {
      window.YKDBanner.hideBanner();
      enqueue();
    } else {
      window.YKDBanner.showBanner(retry);
    }
  }

  async function retry() {
    const reply = await send("ensureConnected");
    setConnected(Boolean(reply?.ok));
  }

  // ------------------------------------------------------------- observers

  function onScroll() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      enqueue();
    }, SCROLL_IDLE_MS);
  }

  function onMutations(mutations) {
    // Ignore mutations we caused ourselves, or the observer loops forever.
    let relevant = false;
    for (const m of mutations) {
      if (m.type === "characterData") {
        if (!window.YKDReplace.handled.has(m.target)) relevant = true;
      } else if (m.addedNodes.length > 0) {
        relevant = true;
      }
      if (relevant) break;
    }
    if (!relevant) return;

    // Newly rendered price containers need converting too; the grid on the
    // home page streams in after load.
    if (conversionActive()) {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            stats.converted += convertGrouped(node);
          }
        }
      }
    }

    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      enqueue();
    }, DEBOUNCE_MS);
  }

  // ------------------------------------------------------------------- init

  async function init() {
    const reply = await send("ping");
    const enabledReply = await send("getEnabled");
    enabled = enabledReply?.enabled !== false;
    if (!enabled) return;

    setConnected(Boolean(reply?.state?.connected));
    if (!connected) {
      const ensured = await send("ensureConnected");
      setConnected(Boolean(ensured?.ok));
    }

    // Rates are needed before the first scan so prices convert on load.
    await loadCurrency();

    enqueue();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    const observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // 1688 is an SPA: a client-side route change replaces most of the DOM.
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        setTimeout(enqueue, 600);
      }
    }, 1000);
  }

  // Messages from the popup / service worker.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case "ykd:state":
        setConnected(Boolean(message.state?.connected));
        sendResponse({ ok: true });
        break;

      case "ykd:enabled":
        enabled = Boolean(message.enabled);
        if (enabled) enqueue();
        sendResponse({ ok: true });
        break;

      case "ykd:revert": {
        const n = revertAll();
        queue = [];
        sendResponse({ ok: true, reverted: n });
        break;
      }

      case "ykd:stats":
        sendResponse({ ok: true, ...stats, queued: queue.length, connected });
        break;

      case "ykd:rescan":
        enqueue();
        sendResponse({ ok: true });
        break;

      case "ykd:currency":
      case "ykd:rates":
        // The preference changed in another tab or in options; re-apply.
        loadCurrency().then(() => enqueue());
        sendResponse({ ok: true });
        break;

      default:
        return false;
    }
    return true;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
