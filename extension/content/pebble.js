/**
 * The floating compose pebble.
 *
 * A small button that appears only on pages that actually have a chat
 * composer, and opens a rounded input for writing a message in your own
 * language. Sending translates it into Chinese and drops it into the site's
 * message box — it does not send, so you can review it first.
 *
 * Everything lives in a shadow root: the page's CSS cannot reach in, and ours
 * cannot leak out onto a commerce site.
 */

(() => {
  "use strict";

  const HOST_ID = "ykd-pebble-host";
  const POS_KEY = "pebblePos";
  const TARGET_LANGUAGE = "Chinese (Simplified)";
  const MAX_LENGTH = 500;

  let host = null;
  let shadow = null;
  let open = false;
  let busy = false;
  let lastFocused = null;

  const el = {};

  // ------------------------------------------------------------- persistence

  async function loadPosition() {
    try {
      const { [POS_KEY]: pos } = await chrome.storage.local.get(POS_KEY);
      return pos && Number.isFinite(pos.left) && Number.isFinite(pos.top) ? pos : null;
    } catch {
      return null;
    }
  }

  function savePosition(pos) {
    chrome.storage.local.set({ [POS_KEY]: pos }).catch(() => {});
  }

  // ------------------------------------------------------------------ markup

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    .btn {
      position: fixed;
      width: 46px; height: 46px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      background: #0d9488;
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,.32), 0 1px 3px rgba(0,0,0,.2);
      transition: transform .12s ease, filter .12s ease;
      z-index: 2147483647;
      touch-action: none;
      user-select: none;
    }
    .btn:hover { filter: brightness(1.12); }
    .btn:active { transform: scale(.94); }
    .btn.dragging { cursor: grabbing; transform: scale(1.06); filter: brightness(1.15); }
    .btn svg { width: 22px; height: 22px; display: block; pointer-events: none; }

    .pebble {
      position: fixed;
      width: 296px;
      background: #141416;
      color: #cacacd;
      border: 1px solid #2e2e30;
      border-radius: 14px;
      padding: 10px;
      box-shadow: 0 10px 34px rgba(0,0,0,.45);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      z-index: 2147483647;
      display: none;
    }
    .pebble.open { display: block; }

    .head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 7px;
    }
    .title { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #7c7c7e; }
    .close {
      background: none; border: none; color: #7c7c7e; cursor: pointer;
      font-size: 15px; line-height: 1; padding: 2px 5px; border-radius: 6px;
    }
    .close:hover { color: #e8e8ea; background: #26262a; }

    textarea {
      width: 100%; height: 74px; resize: none;
      background: #1f1f21; color: #e8e8ea;
      border: 1px solid #2e2e30; border-radius: 10px;
      padding: 8px 10px; font: inherit; outline: none;
      display: block;
    }
    textarea:focus { border-color: #0d9488; }
    textarea::placeholder { color: #6a6a6c; }

    .foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .count { font-size: 11px; color: #6a6a6c; flex: none; }

    .send {
      flex: 1; padding: 8px 12px; border-radius: 9px; border: none;
      background: #0d9488; color: #fff; font: inherit; font-weight: 600;
      cursor: pointer;
    }
    .send:hover { filter: brightness(1.1); }
    .send:disabled { opacity: .5; cursor: default; filter: none; }

    .note {
      margin-top: 7px; font-size: 11px; line-height: 1.4;
      color: #7c7c7e; min-height: 15px; word-break: break-word;
    }
    .note.err { color: #f87171; }
    .note.ok { color: #0d9488; }
  `;

  function build() {
    host = document.createElement("div");
    host.id = HOST_ID;
    // The host itself must not intercept clicks; its children handle their own.
    // Start hidden: the visibility gate turns it on only once it has confirmed
    // a composer exists, so there is never a stray button before that check.
    host.style.cssText = "all:initial;position:static;display:none;";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.type = "button";
    btn.title = "Write a message in your language (translated to Chinese)";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    shadow.appendChild(btn);
    el.btn = btn;

    const pebble = document.createElement("div");
    pebble.className = "pebble";
    pebble.innerHTML = `
      <div class="head">
        <span class="title">Message in Chinese</span>
        <button class="close" type="button" title="Close">&times;</button>
      </div>
      <textarea maxlength="${MAX_LENGTH}"
        placeholder="Type in your language… e.g. Hello, is this in stock?"></textarea>
      <div class="foot">
        <span class="count">0/${MAX_LENGTH}</span>
        <button class="send" type="button">Translate &amp; insert</button>
      </div>
      <div class="note"></div>
    `;
    shadow.appendChild(pebble);
    el.pebble = pebble;
    el.textarea = pebble.querySelector("textarea");
    el.send = pebble.querySelector(".send");
    el.close = pebble.querySelector(".close");
    el.count = pebble.querySelector(".count");
    el.note = pebble.querySelector(".note");

    (document.body || document.documentElement).appendChild(host);
  }

  // --------------------------------------------------------------- placement

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /** Keep a position inside the viewport, so a resize cannot strand the UI. */
  function clampPos(left, top, width = 46, height = 46) {
    const maxLeft = Math.max(0, window.innerWidth - width - 4);
    const maxTop = Math.max(0, window.innerHeight - height - 4);
    return { left: clamp(left, 4, maxLeft), top: clamp(top, 4, maxTop) };
  }

  function applyPos(pos) {
    el.btn.style.left = `${pos.left}px`;
    el.btn.style.top = `${pos.top}px`;
    el.btn.style.right = "auto";
    el.btn.style.bottom = "auto";
    positionPebble(pos);
  }

  function positionPebble(pos) {
    const pw = 296;
    const gap = 10;
    // Prefer opening to the right of the button; flip when there is no room.
    let left = pos.left + gap;
    if (left + pw > window.innerWidth - 4) left = pos.left - pw - gap;
    left = clamp(left, 4, Math.max(4, window.innerWidth - pw - 4));
    const top = clamp(pos.top, 4, Math.max(4, window.innerHeight - 210));
    el.pebble.style.left = `${left}px`;
    el.pebble.style.top = `${top}px`;
  }

  let dragState = null;

  function onPointerDown(event) {
    if (event.button !== 0) return;
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      origLeft: el.btn.getBoundingClientRect().left,
      origTop: el.btn.getBoundingClientRect().top,
      moved: false,
    };
    // Capture keeps pointermove flowing to the button when the pointer leaves
    // it mid-drag. It throws for synthetic events and for pointers the browser
    // no longer considers active, so it is best-effort only.
    try {
      el.btn.setPointerCapture(event.pointerId);
    } catch {
      // Not fatal: the drag still works while the pointer stays over the button.
    }
    el.btn.classList.add("dragging");
  }

  function onPointerMove(event) {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    // A few pixels of slop, so a slightly shaky click still counts as a click.
    if (!dragState.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    dragState.moved = true;
    const pos = clampPos(dragState.origLeft + dx, dragState.origTop + dy);
    applyPos(pos);
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!dragState) return;
    const moved = dragState.moved;
    dragState = null;
    el.btn.classList.remove("dragging");

    // The browser releases capture implicitly on pointerup, so this usually
    // throws NotFoundError. Guard it: an uncaught throw here used to abort the
    // handler before the position was saved.
    try {
      el.btn.releasePointerCapture(event.pointerId);
    } catch {
      // Already released — expected on a normal click.
    }

    if (moved) {
      const rect = el.btn.getBoundingClientRect();
      savePosition({ left: rect.left, top: rect.top });
    } else {
      toggle();
    }
  }

  // ------------------------------------------------------------- open / close

  function toggle() {
    open ? closePebble() : openPebble();
  }

  function openPebble() {
    open = true;
    el.pebble.classList.add("open");
    const rect = el.btn.getBoundingClientRect();
    positionPebble({ left: rect.left, top: rect.top });
    setNote("");
    el.textarea.focus();
  }

  function closePebble() {
    open = false;
    el.pebble.classList.remove("open");
  }

  function setNote(text, kind = "") {
    el.note.textContent = text;
    el.note.className = `note${kind ? " " + kind : ""}`;
  }

  // ------------------------------------------------------------------- send

  async function send() {
    if (busy) return;
    const text = el.textarea.value.trim();

    if (!text) {
      setNote("Type a message first.", "err");
      return;
    }

    // Already Chinese: nothing to translate, insert as-is.
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) {
      const composer = window.YKDCompose.findComposer();
      if (!composer) {
        setNote("Could not find the message box on this page.", "err");
        return;
      }
      window.YKDCompose.insertIntoComposer(composer, text);
      finish("Inserted (already Chinese).");
      return;
    }

    const composer = window.YKDCompose.findComposer();
    if (!composer) {
      setNote("Could not find the message box on this page.", "err");
      return;
    }

    busy = true;
    el.send.disabled = true;
    setNote("Translating…");

    try {
      const reply = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "translate", texts: [text], target: TARGET_LANGUAGE },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response ?? { ok: false, error: "No response" });
            }
          },
        );
      });

      if (!reply?.ok) {
        setNote(reply?.error || "Translation failed. Is the YKD AI app running?", "err");
        return;
      }

      const translated = reply.translations?.[0];
      if (!translated) {
        setNote("The translator returned nothing. Try again.", "err");
        return;
      }

      if (!window.YKDCompose.insertIntoComposer(composer, translated)) {
        setNote("Could not write into the message box.", "err");
        return;
      }

      finish(translated);
    } catch (err) {
      setNote(String(err?.message ?? err), "err");
    } finally {
      busy = false;
      el.send.disabled = false;
    }
  }

  /** Success: show what was inserted, then get out of the way. */
  function finish(message) {
    lastFocused = document.activeElement;
    closePebble();
    el.textarea.value = "";
    updateCount();
    setNote("");
    if (lastFocused && lastFocused !== document.body) {
      // Leave focus in the chat box so the user can just press send.
    }
    console.debug("[YKD] inserted:", message);
  }

  function updateCount() {
    el.count.textContent = `${el.textarea.value.length}/${MAX_LENGTH}`;
  }

  // ------------------------------------------------------------------ wiring

  function wire() {
    el.btn.addEventListener("pointerdown", onPointerDown);
    el.btn.addEventListener("pointermove", onPointerMove);
    el.btn.addEventListener("pointerup", onPointerUp);
    el.btn.addEventListener("pointercancel", () => {
      dragState = null;
      el.btn.classList.remove("dragging");
    });

    el.close.addEventListener("click", closePebble);
    el.send.addEventListener("click", send);
    el.textarea.addEventListener("input", updateCount);
    el.textarea.addEventListener("keydown", (event) => {
      // Ctrl/Cmd+Enter sends, matching the surrounding app's habits.
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        send();
      }
      if (event.key === "Escape") closePebble();
    });

    // Clicking outside closes, without stealing the click from the page.
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!open) return;
        if (event.composedPath?.().includes(host)) return;
        closePebble();
      },
      true,
    );

    window.addEventListener("resize", () => {
      const rect = el.btn.getBoundingClientRect();
      const pos = clampPos(rect.left, rect.top);
      applyPos(pos);
      savePosition(pos);
    });
  }

  // -------------------------------------------------------------------- init

  /**
   * Show the button only while the page actually has a chat composer.
   *
   * 1688 renders the chat shell before the message box exists, and swaps the
   * DOM on navigation, so this is polled rather than checked once. Polling is
   * cheap: a couple of querySelectorAll calls on a selector list that matches
   * almost nothing.
   *
   * The first pass always applies (rather than short-circuiting on "no
   * change"), because the host starts hidden and `shown` starts false — an
   * early return there would leave the button visible on frames that have no
   * composer at all, which is how a second stray button appeared on the chat
   * shell iframe.
   */
  let gateTimer = null;
  let shown = null;

  function updateVisibility() {
    let present = false;
    try {
      present = window.YKDCompose.hasComposer();
    } catch {
      present = false;
    }

    if (present === shown) return;
    shown = present;
    host.style.display = present ? "" : "none";
    if (!present) closePebble();
  }

  function startGate() {
    updateVisibility();
    if (gateTimer === null) {
      gateTimer = setInterval(updateVisibility, 1000);
    }
  }

  async function init() {
    build();
    wire();

    const pos = (await loadPosition()) ?? { left: 18, top: window.innerHeight - 120 };
    applyPos(clampPos(pos.left, pos.top));

    startGate();

    window.YKDPebble = { open: openPebble, close: closePebble, send, get host() { return host; } };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
