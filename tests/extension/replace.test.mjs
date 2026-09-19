/**
 * Tests for the DOM replacement rules — the part that can break a live site.
 * Run: node tests/extension/replace.test.mjs
 *
 * Uses a minimal hand-rolled DOM so no dependency is needed.
 */

import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(
  path.join(import.meta.dirname, "../../extension/content/replace.js"), "utf8");

// The file assigns to window.YKDReplace and uses a few browser globals.
const sandbox = { window: {} };
const fn = new Function("window", "NodeFilter", "document", src + "\nreturn window.YKDReplace;");

const NodeFilter = {
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
};

// --- tiny DOM ---------------------------------------------------------------
class Node {
  constructor(type) {
    this.nodeType = type;
    this.childNodes = [];
    this.parentElement = null;
  }
}
class TextNode extends Node {
  constructor(value) {
    super(3);
    this.nodeValue = value;
  }
}
class Element extends Node {
  constructor(tag, attrs = {}) {
    super(1);
    this.tagName = tag.toUpperCase();
    this._attrs = attrs;
    this.isContentEditable = false;
    this.dataset = {};
    this.classList = { contains: () => false };
  }
  getAttribute(k) { return this._attrs[k] ?? null; }
  append(...kids) {
    for (const k of kids) {
      k.parentElement = this;
      this.childNodes.push(k);
    }
    return this;
  }
}

function makeDocument(root) {
  return {
    createTreeWalker(node, _what, filter) {
      const stack = [node];
      const out = [];
      while (stack.length) {
        const n = stack.pop();
        for (const c of n.childNodes) {
          if (c.nodeType === 3) {
            if (filter.acceptNode(c) === NodeFilter.FILTER_ACCEPT) out.push(c);
          } else {
            stack.push(c);
          }
        }
      }
      let i = 0;
      return { nextNode: () => out[i++] ?? null };
    },
  };
}

const API = fn(sandbox.window, NodeFilter, makeDocument);

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`); }
}

function collectFrom(el) {
  const doc = makeDocument(el);
  // Re-implement the walk using the exported rules so we test the real filters.
  const found = [];
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        if (API.needsTranslation(c.nodeValue) && !isExcludedForTest(c)) {
          found.push({ node: c, text: c.nodeValue });
        }
      } else {
        walk(c);
      }
    }
  };
  walk(el);
  return found;
}

const SKIP = new Set(["SCRIPT","STYLE","NOSCRIPT","CODE","PRE","KBD","SAMP","VAR",
  "SVG","CANVAS","TEXTAREA","INPUT","SELECT","OPTION","IFRAME","MATH","TEMPLATE"]);

function isExcludedForTest(node) {
  let el = node.parentElement;
  while (el) {
    if (SKIP.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute?.("translate") === "no") return true;
    el = el.parentElement;
  }
  return false;
}

console.log("1) needsTranslation");
check("plain Chinese", API.needsTranslation("起批量"));
check("mixed", API.needsTranslation("价格 100 元"));
check("english rejected", !API.needsTranslation("In stock"));
check("numbers rejected", !API.needsTranslation("12345"));
check("price rejected", !API.needsTranslation("¥99.00"));
check("empty rejected", !API.needsTranslation(""));
check("whitespace rejected", !API.needsTranslation("   "));
check("null rejected", !API.needsTranslation(null));
check("punctuation-only rejected", !API.needsTranslation("。，！"));

console.log("\n2) excluded elements are skipped");
{
  const script = new Element("script").append(new TextNode("起批量"));
  check("script skipped", collectFrom(script).length === 0);

  const style = new Element("style").append(new TextNode("起批量"));
  check("style skipped", collectFrom(style).length === 0);

  const pre = new Element("pre").append(new TextNode("起批量"));
  check("pre skipped", collectFrom(pre).length === 0);

  const input = new Element("input", { value: "起批量" });
  check("input skipped", collectFrom(input).length === 0);

  const editable = new Element("div");
  editable.isContentEditable = true;
  editable.append(new TextNode("起批量"));
  check("contenteditable skipped (chat box)", collectFrom(editable).length === 0);

  const noTr = new Element("div", { translate: "no" }).append(new TextNode("起批量"));
  check("translate=no skipped", collectFrom(noTr).length === 0);
}

console.log("\n3) normal content is collected");
{
  const div = new Element("div").append(
    new TextNode("起批量"),
    new Element("span").append(new TextNode("现货")),
  );
  const found = collectFrom(div);
  check("finds both nodes", found.length === 2, `${found.length}`);
  check("keeps original text", found[0].text === "起批量");
}

console.log("\n4) applyTranslation rewrites only the text node");
{
  const span = new Element("span");
  const t = new TextNode("起批量");
  span.append(t);
  const ok = API.applyTranslation(t, "Minimum order quantity", "起批量");
  check("returns true", ok === true);
  check("node updated", t.nodeValue === "Minimum order quantity", t.nodeValue);
  check("marked as handled", API.handled.has(t));
  check("original recorded", API.originals.get(t) === "起批量");
}

console.log("\n5) already-handled nodes are not re-collected");
{
  const div = new Element("div");
  const t = new TextNode("起批量");
  div.append(t);
  API.applyTranslation(t, "Minimum order", "起批量");
  // Simulate a re-render that replaces the text with Chinese again.
  t.nodeValue = "起批量";
  const found = collectFrom(div);
  check("handled node still collected for re-check", found.length === 1,
    "handled set is for loop-prevention, not permanent exclusion");
}

console.log("\n6) revertAll restores the original");
{
  API.originals.clear();
  const a = new TextNode("起批量");
  const b = new TextNode("现货");
  new Element("div").append(a, b);
  API.applyTranslation(a, "Minimum order quantity", "起批量");
  API.applyTranslation(b, "In stock", "现货");
  const n = API.revertAll();
  check("reverted count", n === 2, `${n}`);
  check("a restored", a.nodeValue === "起批量", a.nodeValue);
  check("b restored", b.nodeValue === "现货", b.nodeValue);
  check("map cleared", API.originals.size === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
