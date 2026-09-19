/**
 * Guard: every file listed as a content script must be loadable as a CLASSIC
 * script. Run: node tests/extension/manifest.test.mjs
 *
 * Chrome injects content scripts as classic scripts, not ES modules. An
 * `export` (or `import`) statement in one is a SyntaxError that aborts that
 * file AND every script after it in the list — so two new files silently
 * prevented the currency and price code from loading, while the scripts before
 * them worked fine. That is invisible in the page and easy to miss.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const ext = path.join(root, "extension");

const manifest = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json"), "utf8"));

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`); }
}

console.log("1) content scripts must be valid classic scripts");
{
  const files = manifest.content_scripts.flatMap((cs) => cs.js ?? []);
  check("manifest lists content scripts", files.length > 0, `${files.length}`);

  for (const rel of files) {
    const abs = path.join(ext, rel);
    if (!fs.existsSync(abs)) {
      check(`${rel} exists`, false, "listed in the manifest but missing on disk");
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");

    // `export` / `import` at the start of a line = module syntax.
    const hasModuleSyntax = /^\s*(export|import)\s/m.test(src);

    // Parse it the way Chrome will: as a classic script body.
    let parses = true;
    let err = "";
    try {
      // eslint-disable-next-line no-new-func
      new Function(src);
    } catch (e) {
      parses = false;
      err = e.message;
    }

    check(`${rel} loads as a classic script`, parses && !hasModuleSyntax,
      err || (hasModuleSyntax ? "contains export/import (module-only syntax)" : ""));
  }
}

console.log("\n2) web-accessible resources exist");
{
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const rel of entry.resources ?? []) {
      check(`${rel} exists`, fs.existsSync(path.join(ext, rel)));
    }
  }
}

console.log("\n3) every content script the code expects is registered");
{
  const files = manifest.content_scripts.flatMap((cs) => cs.js ?? []);
  const expected = [
    "content/replace.js",
    "content/banner.js",
    "content/compose.js",
    "content/price.js",
    "content/content.js",
    "content/pebble.js",
  ];
  for (const rel of expected) {
    check(`${rel} registered`, files.includes(rel));
  }
  check("a currencies data file is registered",
    files.some((f) => f.includes("currencies")));
}

console.log("\n4) the currencies data file has no module syntax but still defines the API");
{
  const rel = manifest.content_scripts
    .flatMap((cs) => cs.js ?? [])
    .find((f) => f.includes("currencies"));
  if (rel) {
    const src = fs.readFileSync(path.join(ext, rel), "utf8");
    check("no export/import in the data file", !/^\s*(export|import)\s/m.test(src));
    check("defines globalThis.YKDCurrency", /globalThis\.YKDCurrency\s*=/.test(src));
    // Run it and confirm the namespace appears.
    const fn = new Function("globalThis", "window",
      src + "\nreturn globalThis.YKDCurrency;");
    const sandbox = {};
    const api = fn(sandbox, sandbox);
    check("loads and exposes currencies", Boolean(api?.CURRENCIES?.length),
      `${api?.CURRENCIES?.length}`);
    check("LKR present", Boolean(api?.findCurrency?.("LKR")));
  }
}

console.log("\n5) extension pages load as classic scripts too");
{
  // options.html is an extension page: its <script src> files are classic
  // scripts. An `import` there is a SyntaxError that kills the whole page —
  // which is exactly how the currency dropdown silently never populated.
  const html = fs.readFileSync(path.join(ext, "options/options.html"), "utf8");
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  check("options.html loads scripts", scripts.length > 0, `${scripts.length}`);

  for (const rel of scripts) {
    const abs = path.resolve(path.join(ext, "options"), rel);
    if (!fs.existsSync(abs)) {
      check(`${rel} exists`, false, "referenced by options.html but missing");
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    const hasModuleSyntax = /^\s*(export|import)\s/m.test(src);
    let parses = true;
    let err = "";
    try {
      // eslint-disable-next-line no-new-func
      new Function(src);
    } catch (e) {
      parses = false;
      err = e.message;
    }
    check(`options ${rel} loads as a classic script`, parses && !hasModuleSyntax,
      err || (hasModuleSyntax ? "contains export/import" : ""));
  }

  // The currencies data must be loaded BEFORE options.js uses window.YKDCurrency.
  const dataIdx = scripts.findIndex((s) => s.includes("currencies"));
  const optsIdx = scripts.findIndex((s) => s.includes("options.js"));
  check("currencies data loads before options.js",
    dataIdx !== -1 && dataIdx < optsIdx, `data=${dataIdx} options=${optsIdx}`);

  // Classic scripts share ONE top-level scope. Destructuring a name the data
  // file already declared throws "Identifier 'X' has already been declared" at
  // load, killing the page. options.js must read them off the namespace.
  const optsSrc = fs.readFileSync(path.join(ext, "options/options.js"), "utf8");
  const dataSrc = fs.readFileSync(
    path.join(ext, "options", scripts[dataIdx]), "utf8");
  const declaredInData = [...dataSrc.matchAll(/^\s*(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
  const destructured = [...optsSrc.matchAll(/const\s*\{([^}]*)\}\s*=\s*window\.YKDCurrency/g)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim().split(":")[0].trim()))
    .filter(Boolean);
  const collisions = destructured.filter((n) => declaredInData.includes(n));
  check("no top-level name collision with the data file",
    collisions.length === 0, `collides: ${collisions.join(", ")}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
