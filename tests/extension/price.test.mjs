/**
 * Tests for price detection and conversion.
 * Run: node tests/extension/price.test.mjs
 *
 * A wrong number on a supplier page is worse than a missing one, so the
 * negative cases here matter as much as the positive ones.
 */

import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(
  path.join(import.meta.dirname, "../../extension/content/price.js"), "utf8");

// price.js is a content script (concatenated into one scope, not loaded as a
// module), so it publishes its API on `window` rather than using `export`.
// Provide a minimal window so the file can be evaluated outside a browser.
const win = {};
const mod = new Function(
  "window",
  src + "\nreturn { ...window.YKDPrice };")(win);

const { findPrices, convertPrices, formatAmount } = mod;

// CNY -> LKR at 49.4, matching the live rate on the day this was written.
const ENTRY = { base: "CNY", rates: { CNY: 1, USD: 0.14921713, LKR: 49.40863789 } };

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`); }
}

console.log("1) finds ¥ prices");
{
  check("¥5.00", findPrices("¥5.00").length === 1);
  check("￥1,280", findPrices("￥1,280").length === 1);
  check("¥ 12", findPrices("¥ 12").length === 1);
  check("amount parsed", findPrices("¥5.50")[0].amount === 5.5);
  check("currency is CNY", findPrices("¥5")[0].currency === "CNY");
}

console.log("\n2) finds 元 prices");
{
  const p = findPrices("价格 250元 起");
  check("250元 found", p.length === 1, JSON.stringify(p));
  check("amount 250", p[0]?.amount === 250);
  check("currency CNY", p[0]?.currency === "CNY");
}

console.log("\n3) finds $ prices");
{
  check("$12.50", findPrices("$12.50").length === 1);
  check("currency USD", findPrices("$12.50")[0].currency === "USD");
  check("US$9.99", findPrices("US$9.99").length === 1);
}

console.log("\n4) ranges");
{
  const p = findPrices("¥5-8");
  check("one match, not two", p.length === 1, JSON.stringify(p));
  check("amount 5", p[0]?.amount === 5);
  check("amount2 8", p[0]?.amount2 === 8);
  check("covers the whole range", p[0]?.end - p[0]?.start === 4, `${p[0]?.end - p[0]?.start}`);
  check("tilde range", findPrices("¥5~8")[0]?.amount2 === 8);
  check("至 range", findPrices("¥5至8")[0]?.amount2 === 8);
}

console.log("\n5) things that must NOT be converted");
{
  check("bare number", findPrices("500").length === 0);
  check("quantity 500件", findPrices("500件").length === 0);
  check("percentage 30%", findPrices("折扣 30%").length === 0);
  check("date 2026-09-19", findPrices("2026-09-19").length === 0);
  check("date 2026年9月", findPrices("2026年9月").length === 0);
  check("CN mobile", findPrices("13812345678").length === 0);
  check("HK$ out of scope", findPrices("HK$99").length === 0);
  check("NT$ out of scope", findPrices("NT$99").length === 0);
  check("A$ out of scope", findPrices("A$99").length === 0);
  check("plain text", findPrices("hello world").length === 0);
  check("empty", findPrices("").length === 0);
  check("null safe", findPrices(null).length === 0);
}

console.log("\n6) never converts our own output twice");
{
  check("LKR 247 not re-converted", findPrices("LKR 247").length === 0);
  check("USD 12 not re-converted", findPrices("USD 12").length === 0);
}

console.log("\n7) formatAmount");
{
  check("whole by default (user preference)", formatAmount(246.98, "LKR") === "247");
  check("explicit whole:false honours the currency",
    formatAmount(246.98, "LKR", { whole: false, decimals: 2 }) === "246.98");
  check("LKR 0 decimals", formatAmount(246.98, "LKR", { whole: true }) === "247");
  check("thousands separator", formatAmount(12345.6, "LKR", { whole: true }) === "12,346");
  check("JPY no minor unit", formatAmount(1234.56, "JPY", { whole: true }) === "1,235");
  check("USD two places when not rounding whole",
    formatAmount(12.5, "USD", { whole: false, decimals: 2 }) === "12.50");
}

console.log("\n8) convertPrices rewrites in place");
{
  const r = convertPrices("价格 ¥5.00 现货", ENTRY, "LKR", { whole: true });
  check("changed", r.changed === true);
  check("count 1", r.count === 1, `${r.count}`);
  check("replaced correctly", r.text === "价格 LKR 247 现货", r.text);
}
{
  const r = convertPrices("¥5-8", ENTRY, "LKR", { whole: true });
  check("range converted", r.text === "LKR 247 – 395", r.text);
}
{
  const r = convertPrices("¥5.00 和 ¥10.00", ENTRY, "LKR", { whole: true });
  check("two prices", r.count === 2, `${r.count}`);
  check("both replaced", r.text === "LKR 247 和 LKR 494", r.text);
}
{
  const r = convertPrices("$12.50", ENTRY, "LKR", { whole: true });
  // 12.50 USD -> CNY -> LKR: 12.5 / 0.14921713 * 49.40863789
  const expected = Math.round(12.5 / 0.14921713 * 49.40863789);
  check("USD converted via CNY", r.text === `LKR ${expected.toLocaleString("en-US")}`,
    `${r.text} vs LKR ${expected}`);
}

console.log("\n9) leaves text alone when the rate is missing");
{
  const noRate = { base: "CNY", rates: { CNY: 1 } };
  const r = convertPrices("¥5.00", noRate, "LKR", 0);
  check("unchanged", r.text === "¥5.00", r.text);
  check("changed false", r.changed === false);
}
{
  const r = convertPrices("no prices here", ENTRY, "LKR", { whole: true });
  check("unchanged when nothing to do", r.text === "no prices here");
  check("changed false", r.changed === false);
}

console.log("\n10) real 1688 strings");
{
  const r1 = convertPrices("¥13.00", ENTRY, "LKR", { whole: true });
  check("¥13.00 -> LKR 642", r1.text === "LKR 642", r1.text);

  const r2 = convertPrices("价格 250元 起订量 500件", ENTRY, "LKR", { whole: true });
  check("250元 converted, 500件 left alone",
    r2.text === "价格 LKR 12,352 起订量 500件", r2.text);

  // A seller message quoting a price.
  const r3 = convertPrices("老板，这个 ¥5.5 一件，500件起批", ENTRY, "LKR", { whole: true });
  check("chat price converted", r3.text === "老板，这个 LKR 272 一件，500件起批", r3.text);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
