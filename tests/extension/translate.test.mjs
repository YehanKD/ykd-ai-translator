/**
 * Tests for batch prompt building and response parsing.
 * Run: node tests/extension/translate.test.mjs
 */

import { buildPrompt, parseBatch, makeBatches, hasChinese, BATCH_SIZE }
  from "../../extension/background/translate.js";

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  [PASS] ${label}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`);
  }
}

console.log("1) hasChinese");
check("detects Chinese", hasChinese("起批量"));
check("detects mixed", hasChinese("价格 100"));
check("rejects latin", !hasChinese("hello world"));
check("rejects numbers", !hasChinese("12345"));
check("rejects empty", !hasChinese(""));
check("rejects non-string", !hasChinese(null));

console.log("\n2) buildPrompt");
const p = buildPrompt(["起批量", "现货"], "English");
check("numbers from 1", p.includes("1. 起批量") && p.includes("2. 现货"), p);
check("names the target", p.includes("into English"));
check("demands only translations", /ONLY/i.test(p));

console.log("\n3) parseBatch — clean output");
let r = parseBatch("1. Minimum order quantity\n2. In stock", 2);
check("parses both", r[0] === "Minimum order quantity" && r[1] === "In stock", JSON.stringify(r));

console.log("\n4) parseBatch — tolerates formatting drift");
r = parseBatch("1) First\n2) Second", 2);
check("accepts paren numbering", r[0] === "First" && r[1] === "Second", JSON.stringify(r));

r = parseBatch("1. First\n2. Second", 3);
check("missing entry becomes null", r[2] === null, JSON.stringify(r));

r = parseBatch("Here are the translations:\n1. First\n2. Second\nHope that helps!", 2);
check("ignores prose preamble and trailer",
  r[0] === "First" && r[1] === "Second", JSON.stringify(r));

r = parseBatch("1. 1. Duplicated numbering\n2. Second", 2);
check("handles doubled numbering", r[0] === "Duplicated numbering", JSON.stringify(r));

r = parseBatch("1. First\n5. Out of range", 2);
check("drops out-of-range index", r[1] === null, JSON.stringify(r));

r = parseBatch("", 2);
check("empty response -> all null", r.every((x) => x === null), JSON.stringify(r));

r = parseBatch(null, 2);
check("null response -> all null", r.every((x) => x === null), JSON.stringify(r));

r = parseBatch("no numbering at all", 2);
check("unnumbered output -> all null (never guess)", r.every((x) => x === null), JSON.stringify(r));

r = parseBatch("1. First\n1. First again", 2);
check("first occurrence wins on duplicate index", r[0] === "First", JSON.stringify(r));

r = parseBatch("1. \n2. Second", 2);
check("blank entry stays null", r[0] === null && r[1] === "Second", JSON.stringify(r));

console.log("\n5) parseBatch — preserves Chinese when the model echoes the source");
r = parseBatch("1. 起批量", 1);
check("echoed source is returned as-is (caller decides)", r[0] === "起批量", JSON.stringify(r));

console.log("\n6) makeBatches");
let batches = makeBatches(Array.from({ length: 60 }, (_, i) => `s${i}`));
check("splits by count", batches.length === Math.ceil(60 / BATCH_SIZE),
  `${batches.length} batches`);
check("no batch exceeds BATCH_SIZE", batches.every((b) => b.length <= BATCH_SIZE));

batches = makeBatches(["x".repeat(7000), "small"]);
check("oversized segment gets its own batch", batches.length === 2 &&
  batches[0].length === 1, JSON.stringify(batches.map((b) => b.length)));

batches = makeBatches([]);
check("empty input -> no batches", batches.length === 0);

batches = makeBatches(["a", "b", "c"]);
check("small input -> one batch", batches.length === 1 && batches[0].length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
