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

  /** Nodes waiting to be translated, visible ones first. */
  let queue = [];
  let inFlight = 0;
  let enabled = true;
  let connected = false;
  let scrollTimer = null;
  let mutationTimer = null;
  let stopped = false;

  const stats = { queued: 0, translated: 0 };

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

  // ------------------------------------------------------------- collection

  /** Scan the document (or a subtree) and add new nodes to the queue. */
  function enqueue(root = document.body) {
    if (!enabled || stopped || !root) return;
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
