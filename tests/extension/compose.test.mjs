/**
 * Tests for composer discovery and insertion.
 * Run: node tests/extension/compose.test.mjs
 *
 * The selector list is what decides whether the pebble appears on a page, so
 * these cover the false-positive risks (search boxes, hidden editables) as
 * well as the real 1688 markup.
 */

import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(
  path.join(import.meta.dirname, "../../extension/content/compose.js"), "utf8");

// --- minimal DOM ------------------------------------------------------------

class Element {
  constructor(tag, attrs = {}, rect = { width: 300, height: 40 }) {
    this.tagName = tag.toUpperCase();
    this._attrs = attrs;
    this.isContentEditable = attrs.contenteditable === "true";
    this.isConnected = true;
    this.disabled = false;
    this.readOnly = false;
    this.value = "";
    this.textContent = "";
    this._rect = { x: 0, y: 0, ...rect };
    this._style = {};
  }
  getAttribute(k) { return this._attrs[k] ?? null; }
  getBoundingClientRect() {
    return {
      ...this._rect,
      left: this._rect.x, top: this._rect.y,
      right: this._rect.x + this._rect.width,
      bottom: this._rect.y + this._rect.height,
    };
  }
  focus() { this._focused = true; }
  dispatchEvent() { return true; }
}

function makeWindow(elements, { display = "block", visibility = "visible", opacity = "1" } = {}) {
  return {
    getComputedStyle: () => ({ display, visibility, opacity }),
    innerWidth: 1400,
    innerHeight: 900,
  };
}

/**
 * Load compose.js with a fake document whose selectors map to element lists.
 * Each selector key is matched by simple substring logic so the test does not
 * have to reimplement CSS.
 */
function load(elementsBySelector, styleOpts) {
  const win = makeWindow(null, styleOpts);
  const doc = {
    querySelectorAll(selector) {
      const out = [];
      for (const [sel, els] of Object.entries(elementsBySelector)) {
        if (selector === sel) out.push(...els);
      }
      return out;
    },
    createRange: () => ({
      selectNodeContents() {},
    }),
    execCommand: () => true,
  };
  win.document = doc;
  win.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  win.InputEvent = class { constructor(t, o) { Object.assign(this, o, { type: t }); } };
  win.Event = class { constructor(t) { this.type = t; } };

  const sandbox = { window: win, document: doc, InputEvent: win.InputEvent, Event: win.Event };
  const fn = new Function(
    "window", "document", "InputEvent", "Event",
    src + "\nreturn window.YKDCompose;");
  return fn(win, doc, win.InputEvent, win.Event);
}

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`); }
}

const SEL_1688 = 'pre.edit[contenteditable="true"]';
const SEL_SENDBOX = '.send-box [contenteditable="true"]';
const SEL_DIV = 'div[contenteditable="true"]';

console.log("1) finds the real 1688 chat input");
{
  const input = new Element("pre", { contenteditable: "true" }, { width: 620, height: 84 });
  const api = load({ [SEL_1688]: [input] });
  const found = api.findComposer();
  check("finds <pre contenteditable>", found === input);
  check("hasComposer true", api.hasComposer() === true);
}

console.log("\n2) ignores things that are not composers");
{
  // The contact search box: an <input>, never a message composer.
  const search = new Element("input", { placeholder: "Search for contacts" });
  const api = load({ [SEL_1688]: [], [SEL_DIV]: [search] });
  check("plain <input> ignored", api.findComposer() === null,
    "typing a supplier message into a search box would be worse than no button");

  // A small contenteditable (icon holder, inline editor).
  const tiny = new Element("div", { contenteditable: "true" }, { width: 40, height: 20 });
  const api2 = load({ [SEL_1688]: [], [SEL_DIV]: [tiny] });
  check("tiny editable ignored", api2.findComposer() === null,
    "below the minimum size, so not a composer");

  // Hidden editable.
  const hidden = new Element("div", { contenteditable: "true" }, { width: 600, height: 80 });
  const api3 = load({ [SEL_1688]: [], [SEL_DIV]: [hidden] }, { display: "none" });
  check("hidden editable ignored", api3.findComposer() === null);

  const invisible = new Element("div", { contenteditable: "true" }, { width: 600, height: 80 });
  const api4 = load({ [SEL_1688]: [], [SEL_DIV]: [invisible] }, { visibility: "hidden" });
  check("visibility:hidden ignored", api4.findComposer() === null);

  // Zero-size (not laid out yet).
  const zero = new Element("div", { contenteditable: "true" }, { width: 0, height: 0 });
  const api5 = load({ [SEL_1688]: [], [SEL_DIV]: [zero] });
  check("zero-size ignored", api5.findComposer() === null);

  // Disabled / readonly.
  const ro = new Element("div", { contenteditable: "true" }, { width: 600, height: 80 });
  ro.readOnly = true;
  const api6 = load({ [SEL_1688]: [], [SEL_DIV]: [ro] });
  check("readonly ignored", api6.findComposer() === null);
}

console.log("\n3) no composer at all => no button");
{
  const api = load({ [SEL_1688]: [], [SEL_SENDBOX]: [], [SEL_DIV]: [] });
  check("findComposer null", api.findComposer() === null);
  check("hasComposer false", api.hasComposer() === false);
}

console.log("\n4) prefers the most specific selector");
{
  // Both a generic div and the 1688 pre exist; the pre must win.
  const generic = new Element("div", { contenteditable: "true" }, { width: 900, height: 200 });
  const real = new Element("pre", { contenteditable: "true" }, { width: 400, height: 60 });
  const api = load({ [SEL_1688]: [real], [SEL_DIV]: [generic] });
  check("1688 <pre> wins over a bigger generic div", api.findComposer() === real);
}

console.log("\n5) biggest box wins within one selector");
{
  const small = new Element("pre", { contenteditable: "true" }, { width: 300, height: 40 });
  const big = new Element("pre", { contenteditable: "true" }, { width: 700, height: 90 });
  const api = load({ [SEL_1688]: [small, big] });
  check("largest editable chosen", api.findComposer() === big);
}

console.log("\n6) insertIntoComposer");
{
  const input = new Element("pre", { contenteditable: "true" }, { width: 620, height: 84 });
  let execCalled = null;
  const win = makeWindow(null);
  const doc = {
    querySelectorAll: () => [],
    createRange: () => ({ selectNodeContents() {} }),
    execCommand: (cmd, _ui, text) => { execCalled = { cmd, text }; return true; },
  };
  win.document = doc;
  win.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  const sandbox = { window: win, document: doc };
  const fn = new Function("window", "document", "InputEvent", "Event",
    src + "\nreturn window.YKDCompose;");
  const api = fn(win, doc, class {}, class {});

  const ok = api.insertIntoComposer(input, "你好，有货吗？");
  check("returns true", ok === true);
  check("used execCommand insertText", execCalled?.cmd === "insertText",
    JSON.stringify(execCalled));
  check("inserted the translated text", execCalled?.text === "你好，有货吗？");
  check("focused the composer", input._focused === true);
}

console.log("\n7) insertIntoComposer guards bad input");
{
  const api = load({ [SEL_1688]: [] });
  check("null element => false", api.insertIntoComposer(null, "hi") === false);
  check("non-string => false", api.insertIntoComposer(new Element("div"), null) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
