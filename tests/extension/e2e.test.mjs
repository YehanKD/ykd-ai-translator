/**
 * End-to-end: translate a realistic 1688 page batch through the real app.
 *
 * Requires the YKD AI app to be running. Verifies the exact prompt/parse path
 * the extension uses, against the actual model.
 *
 * Run: node tests/extension/e2e.test.mjs
 */

import { buildPrompt, parseBatch, makeBatches }
  from "../../extension/background/translate.js";

const BASE = process.env.YKD_BASE ?? "http://127.0.0.1:8765";

// Realistic 1688 strings: product page + seller chat.
const SEGMENTS = [
  "起批量",                       // minimum order quantity
  "现货",                         // in stock
  "价格面议",                     // price negotiable
  "支持一件代发",
  "48小时内发货",
  "质量保证，七天无理由退换",
  "你好，这个款式有货吗？",
  "有的，请问您需要多少件？",
  "我要500件，能便宜点吗",
  "500件的话可以给您优惠价",
  "运费怎么算？",
  "广东省内包邮",
  "这款是纯棉的吗",
  "是的，100%纯棉，不起球",
  "能不能发顺丰",
  "可以的，需要补差价",
  "什么时候能发货",
  "今天下午就可以安排",
  "规格",
  "颜色分类",
  "商品详情",
  "累计销量",
  "好评率",
  "发货地",
  "广东 广州",
];

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`); }
}

async function health() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function ask(prompt) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  return d?.choices?.[0]?.message?.content ?? "";
}

const CJK = /[\u4e00-\u9fff]/;

async function main() {
  console.log(`Checking the app at ${BASE} …`);
  if (!(await health())) {
    console.log("\nSKIP: the YKD AI app is not running.");
    console.log("Start it, then re-run: node tests/extension/e2e.test.mjs");
    process.exit(0);
  }
  check("app reachable", true);

  const batches = makeBatches(SEGMENTS);
  console.log(`\nTranslating ${SEGMENTS.length} segments in ${batches.length} batch(es)\n`);

  const results = new Array(SEGMENTS.length).fill(null);
  let cursor = 0;

  for (const batch of batches) {
    const started = Date.now();
    const raw = await ask(buildPrompt(batch, "English"));
    const parsed = parseBatch(raw, batch.length);
    const ms = Date.now() - started;

    parsed.forEach((value, i) => { results[cursor + i] = value; });
    cursor += batch.length;

    const got = parsed.filter(Boolean).length;
    console.log(`  batch of ${batch.length}: ${got}/${batch.length} parsed in ${ms} ms`);
  }

  console.log();
  check("every segment returned a translation",
    results.every(Boolean),
    `${results.filter(Boolean).length}/${results.length}`);

  const stillChinese = results.filter((r) => r && CJK.test(r));
  check("no translation is still Chinese",
    stillChinese.length === 0,
    stillChinese.join(" | "));

  console.log("\n  Sample output:");
  for (let i = 0; i < Math.min(6, results.length); i++) {
    console.log(`    ${SEGMENTS[i]}  ->  ${results[i]}`);
  }
  console.log("\n  Chat lines:");
  for (let i = 6; i < 18 && i < results.length; i++) {
    console.log(`    ${SEGMENTS[i]}  ->  ${results[i]}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
