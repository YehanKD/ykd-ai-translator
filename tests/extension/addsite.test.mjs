/**
 * Tests for the options page's Add-site logic.
 * Run: node tests/extension/addsite.test.mjs
 *
 * The bug this guards against: `chrome.permissions.request` is a no-op outside
 * a user gesture, and it HANGS (rather than throwing) when the gesture was
 * consumed by an earlier await. The click handler then never resolves, no
 * message is shown, and the button looks dead. A pre-check with
 * `await chrome.permissions.contains(...)` before the request caused exactly
 * that.
 *
 * Rather than pattern-matching source text (fragile: comments and URL strings
 * fool naive regexes), these tests LOAD options.js with a mock `chrome` and
 * drive the real click handler.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const optsSrc = fs.readFileSync(path.join(root, "extension/options/options.js"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- fake DOM
function makeElement(id) {
  return {
    id,
    textContent: "",
    className: "",
    value: "",
    disabled: false,
    style: {},
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    async click() {
      for (const fn of this._listeners.click ?? []) await fn();
    },
    appendChild() {},
    append() {},
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    focus() {},
  };
}

/**
 * Load options.js with mocks. `gesture` records whether permissions.request was
 * reached while the "user gesture" was still available — the mock invalidates
 * the gesture as soon as any other async chrome API is awaited, mirroring how
 * Chrome behaves.
 */
function loadOptions({ gestureValid = true, granted = true } = {}) {
  const els = {};
  for (const id of ["msg", "pattern", "add", "list", "toggleEnabled", "conn",
                    "recheck", "currency", "saveCurrency", "togglePrices",
                    "toggleRound", "rateInfo", "refreshRates", "curMsg"]) {
    els[id] = makeElement(id);
  }

  const calls = { request: 0, contains: 0, set: [], registered: null };
  const state = { gesture: true };

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: () => manifest,
      sendMessage: (m, cb) => cb?.({ ok: true, state: { connected: false } }),
    },
    storage: {
      sync: {
        get: async (key) => {
          // NOTE: does NOT burn the gesture. The real handler calls
          // permissions.request() before any storage access, so by the time
          // storage is touched the request has already been made.
          return {};
        },
        set: async (obj) => { calls.set.push(obj); },
        remove: async () => {},
      },
      local: { get: async () => ({}), set: async () => {} },
    },
    permissions: {
      contains: async () => { calls.contains++; state.gesture = false; return false; },
      request: async () => {
        calls.request++;
        calls.requestHadGesture = state.gesture;
        if (!gestureValid) {
          // Real Chrome hangs here when the gesture is gone; never resolves.
          return new Promise(() => {});
        }
        state.gesture = false;
        return granted;
      },
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      unregisterContentScripts: async () => {},
      registerContentScripts: async (list) => { calls.registered = list; },
    },
  };

  const document = {
    getElementById: (id) => els[id] ?? makeElement(id),
    createElement: () => makeElement("x"),
  };

  const fn = new Function(
    "chrome", "document", "window", "setTimeout", "clearTimeout",
    "Promise", "__els", "__calls", "__state",
    optsSrc + "\nreturn { els: __els, calls: __calls, state: __state };");
  // options.js reads window.YKDCurrency, published by currencies.data.js which
  // options.html loads first. Supply the real file's namespace.
  const currenciesSrc = fs.readFileSync(
    path.join(root, "extension/data/currencies.data.js"), "utf8");
  const windowObj = { addEventListener() {} };
  new Function("globalThis", "window", currenciesSrc)(windowObj, windowObj);

  return fn(chrome, document, windowObj,
            setTimeout, clearTimeout, Promise, els, calls, state);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------- tests

console.log("1) adding a site requests permission and registers scripts");
{
  const { els, calls } = loadOptions();
  els.pattern.value = "example.com";
  await els.add.click();
  await flush();

  check("permissions.request was called", calls.request === 1, `${calls.request}`);
  check("request happened with the gesture intact",
    calls.requestHadGesture === true,
    "an await before it would have consumed the gesture");
  check("no permissions.contains() pre-check", calls.contains === 0,
    "contains() consumes the gesture, after which request() hangs forever");

  check("pattern persisted", calls.set.some((o) => o.patterns?.includes("*://*.example.com/*")),
    JSON.stringify(calls.set));
  check("scripts registered", Array.isArray(calls.registered) && calls.registered.length === 1);
  check("input cleared", els.pattern.value === "");
  check("success message shown", /Added/.test(els.msg.textContent), els.msg.textContent);
}

console.log("\n2) a refused permission reports why");
{
  const { els } = loadOptions({ granted: false });
  els.pattern.value = "example.com";
  await els.add.click();
  await flush();
  check("shows an error", /not granted|Could not add/i.test(els.msg.textContent),
    els.msg.textContent);
  check("error styling applied", els.msg.className.includes("err"));
}

console.log("\n3) invalid input is reported, not ignored");
{
  const { els, calls } = loadOptions();
  els.pattern.value = "!!! not a url !!!";
  await els.add.click();
  await flush();
  check("shows an error", /valid site pattern/i.test(els.msg.textContent),
    els.msg.textContent);
  check("did not request permission", calls.request === 0);
}

console.log("\n4) a hanging request still surfaces a waiting notice");
{
  // Simulate the gesture being unavailable: request() never resolves.
  const { els } = loadOptions({ gestureValid: false });
  els.pattern.value = "example.com";
  const clicked = els.add.click();
  await flush();

  check("a waiting notice is visible while pending",
    /Waiting for permission/i.test(els.msg.textContent),
    `msg was ${JSON.stringify(els.msg.textContent)}`);
  check("the Add button is disabled while pending", els.add.disabled === true);

  // Do not await `clicked` — it is intentionally still pending.
  void clicked;
}

console.log("\n5) added sites get the SAME content scripts as the static ones");
{
  const { els, calls } = loadOptions();
  els.pattern.value = "example.com";
  await els.add.click();
  await flush();

  const registeredJs = calls.registered?.[0]?.js ?? [];
  const manifestJs = manifest.content_scripts.flatMap((cs) => cs.js ?? []);

  check("registered js matches the manifest list",
    JSON.stringify(registeredJs) === JSON.stringify(manifestJs),
    `registered ${registeredJs.length} vs manifest ${manifestJs.length}`);
  for (const needed of ["content/price.js", "data/currencies.data.js",
                        "content/compose.js", "content/pebble.js"]) {
    check(`includes ${needed}`, registeredJs.includes(needed));
  }
  check("css is carried over too",
    (calls.registered?.[0]?.css ?? []).length > 0);
}

console.log("\n6) the manifest can request the origins we ask for");
{
  const optional = manifest.optional_host_permissions ?? [];
  check("declares a wildcard-scheme optional host permission",
    optional.includes("*://*/*"),
    `declared: ${JSON.stringify(optional)}`);
}

console.log("\n7) messages are not auto-cleared while waiting");
{
  const { els } = loadOptions({ gestureValid: false });
  els.pattern.value = "example.com";
  void els.add.click();
  await flush();
  const shown = els.msg.textContent;
  await new Promise((r) => setTimeout(r, 4200));
  check("waiting notice survives past the auto-clear window",
    els.msg.textContent === shown && shown.length > 0,
    `was ${JSON.stringify(shown)}, now ${JSON.stringify(els.msg.textContent)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
