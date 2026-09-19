/**
 * Finding prices in text and converting them.
 *
 * Deliberately conservative: a wrong number on a supplier page is worse than a
 * missing conversion, because you might order against it. Every rule below
 * exists to avoid converting something that is not a price.
 *
 * Detected:  ¥5.00 · ￥1,280 · ¥5-8 · ¥5~8 · 5元 · $12.50 · US$12.50 · 5.5元
 * Ignored:   bare numbers · percentages · dates · phone numbers · quantities
 *            like 500件 · already-converted text (no second pass)
 */

/**
 * A money amount.
 *
 * Order matters and is the whole trick. `\d{1,3}(?:,\d{3})+` requires at least
 * one comma group, so it can only match a genuine thousands-separated number;
 * the plain `\d+` alternative then takes any other digit run IN FULL. Writing
 * `\d{1,3}(?:,\d{3})*` instead (comma group optional) makes the engine match
 * just the first three digits of `1006` and stop — which silently corrupted
 * every price of four digits or more (`¥5000` became `LKR 24,7040`).
 */
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;

/**
 * ¥ / ￥ / $ with a number. The symbol must lead.
 *
 * No leading `\s*`: consuming whitespace before the symbol would make it part
 * of the match, so replacing "价格 ¥5.00" would drop the space before the price.
 */
const SYMBOL_PRICE = new RegExp(
  String.raw`(?:(US|HK|NT|A|C|NZ|S)\s*)?[¥￥$]\s*` + AMOUNT, "g");

/** A number followed by 元 (yuan) — 1688 writes prices this way in prose. */
const YUAN_SUFFIX = new RegExp(AMOUNT + String.raw`\s*元`, "g");

/**
 * Ranges: the separator must sit between two money amounts, and the second
 * must be a bare number (¥5-8), not a unit.
 */
const RANGE = new RegExp(String.raw`^([-~～至])\s*` + AMOUNT);

/** Things that look like a price but are not. */
const NOT_A_PRICE = [
  /\d\s*%/,                    // percentages
  /\d{4}[-/年]\d{1,2}/,        // dates: 2026-09, 2026/9, 2026年9月
  /1[3-9]\d{9}/,               // CN mobile numbers
  /^\d{4,}\s*[件个套台只条箱包张对双]/,  // quantities: 500件
];

/**
 * Our own output, e.g. "LKR 247" — never convert it a second time.
 *
 * No `\b`: a word boundary needs a word character on one side, so it would miss
 * "价格LKR 247 现货" and re-convert the number. Requiring whitespace or a
 * non-letter around the code is both looser and more accurate here.
 */
const ALREADY_CONVERTED = /(?<![A-Za-z])[A-Z]{3}\s*[\d,]/;

function isChineseYuan(symbol) {
  return symbol === "¥" || symbol === "￥";
}

/**
 * Split a currency prefix off a symbol match.
 * Returns { currency, symbol } where currency is "CNY" or "USD".
 */
function resolveCurrency(prefix, symbol) {
  if (isChineseYuan(symbol)) return { currency: "CNY", symbol };
  // A leading $ is USD unless an explicit other-dollar prefix precedes it.
  const p = (prefix || "").trim().toUpperCase();
  if (p === "US" || p === "") return { currency: "USD", symbol };
  return { currency: null, symbol };   // HK$, NT$, A$ — not in scope
}

function parseAmount(raw) {
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Find every convertible price in a string.
 *
 * Returns [{ start, end, currency, amount }] in source order, non-overlapping.
 * `start`/`end` are indices into `text` so the caller can rebuild the string
 * without touching anything it did not match.
 */
function findPrices(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  if (ALREADY_CONVERTED.test(text)) return [];

  const found = [];

  // A fresh regex per call: a module-level /g regex carries `lastIndex` across
  // calls, which silently skips matches on every second invocation.
  const symbolRe = new RegExp(SYMBOL_PRICE.source, "g");
  const yuanRe = new RegExp(YUAN_SUFFIX.source, "g");

  // --- symbol prices -------------------------------------------------------
  let m;
  while ((m = symbolRe.exec(text)) !== null) {
    const full = m[0];
    const symbol = full.includes("￥") ? "￥" : full.includes("¥") ? "¥" : "$";
    const { currency } = resolveCurrency(m[1] ?? "", symbol);
    if (!currency) continue;

    const amount = parseAmount(m[2]);
    if (amount === null) continue;

    let end = m.index + full.length;

    // Optional range: "¥5-8" prices the range, not two separate prices.
    const rest = text.slice(end);
    const range = rest.match(RANGE);
    if (range) {
      const second = parseAmount(range[2]);
      if (second !== null) {
        end += range[0].length;
        found.push({ start: m.index, end, currency, amount, amount2: second });
        continue;
      }
    }

    found.push({ start: m.index, end, currency, amount });
  }

  // --- 元 suffix -----------------------------------------------------------
  while ((m = yuanRe.exec(text)) !== null) {
    const amount = parseAmount(m[1]);
    if (amount === null) continue;
    found.push({
      start: m.index,
      end: m.index + m[0].length,
      currency: "CNY",
      amount,
    });
  }

  // Drop overlaps (a ¥ match already covers the digits of a 元 match).
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cursor = -1;
  for (const hit of found) {
    if (hit.start < cursor) continue;
    if (isRejected(text, hit)) continue;
    out.push(hit);
    cursor = hit.end;
  }
  return out;
}

/** Context checks that need the surrounding text. */
function isRejected(text, hit) {
  const context = text.slice(Math.max(0, hit.start - 12), hit.end + 12);
  return NOT_A_PRICE.some((re) => re.test(context));
}

/**
 * Format a converted amount.
 *
 * `whole` (the default) rounds to whole units — the preference the user chose,
 * and the right default for LKR where 246.98 vs 247 is noise on a supplier
 * page. Pass `whole: false` for the currency's own minor units, which matters
 * for currencies where the decimals carry real value (USD cents).
 */
function formatAmount(value, code, { whole = true, decimals } = {}) {
  const places = whole
    ? 0
    : Number.isInteger(decimals)
      ? decimals
      : ["JPY", "KRW", "VND", "IDR", "CLP", "ISK", "UGX"].includes(code) ? 0 : 2;
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/**
 * Convert an amount from `from` into `target`, using a table of rates against
 * the base currency (1 base = N units).
 *
 * Cross-rate: amount / rates[from] gives the base amount, then × rates[target].
 * Dividing by rates[from] (not multiplying) is what makes USD→LKR work — the
 * table stores how many LKR one CNY buys, not one USD.
 */
function convertAmount(entry, amount, from, target) {
  if (!entry?.rates || !from || !target) return null;
  const fromRate = entry.rates[String(from).toUpperCase()];
  const toRate = entry.rates[String(target).toUpperCase()];
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate)) return null;
  const value = (Number(amount) / fromRate) * toRate;
  return Number.isFinite(value) ? value : null;
}

/**
 * Rewrite every price in `text`.
 *
 * Returns { text, changed, count }. When a rate is missing for a currency the
 * original substring is left exactly as it was — never a guessed number.
 *
 * `whole` rounds to whole units of the target currency (the default).
 */
function convertPrices(text, entry, target, options = {}) {
  const { whole = true, decimals } = options;
  const prices = findPrices(text);
  if (prices.length === 0) return { text, changed: false, count: 0 };

  let out = "";
  let cursor = 0;
  let count = 0;

  for (const hit of prices) {
    const first = convertAmount(entry, hit.amount, hit.currency, target);
    if (first === null) continue;
    const second = hit.amount2 !== undefined
      ? convertAmount(entry, hit.amount2, hit.currency, target)
      : null;

    const fmt = (v) => formatAmount(v, target, { whole, decimals });
    const firstText = `${target} ${fmt(first)}`;
    const replacement = second !== null
      ? `${firstText} – ${fmt(second)}`
      : firstText;

    out += text.slice(cursor, hit.start) + replacement;
    cursor = hit.end;
    count++;
  }

  out += text.slice(cursor);
  return { text: out, changed: count > 0, count };
}

/**
 * If `el` holds exactly one price and nothing else, describe it.
 *
 * Shared by the finder and the mutator so both apply identical rules, and so
 * the mutating path is safe to call on any element.
 */
function priceInElement(el) {
  if (!el || el.isContentEditable) return null;

  // A split price spans several child nodes. A single-node price is already
  // handled by the per-text-node pass, so requiring 2+ avoids double work.
  if (!el.childNodes || el.childNodes.length < 2) return null;

  const text = (el.textContent || "").trim();
  if (!text || text.length > 24) return null;

  // A container with a link, button or image is a wrapper, not a price element.
  if (typeof el.querySelector === "function") {
    if (el.querySelector("a, button, img, svg, input, select, textarea")) return null;
  }

  const prices = findPrices(text);
  if (prices.length !== 1) return null;

  const hit = prices[0];
  // The price must BE the content: not preceded by other text, and followed by
  // at most a short unit suffix. Otherwise this is prose or a wrapper.
  if (hit.start !== 0) return null;
  const tail = text.slice(hit.end);
  if (tail.length > 8 || /\d/.test(tail)) return null;

  return { el, amount: hit.amount, currency: hit.currency, tail };
}

/** How far up from a currency symbol to look for its price container. */
const MAX_CLIMB = 5;

/**
 * Prices split across sibling elements.
 *
 * 1688 renders these differently per page, and the markup differs enough that
 * class names alone cannot be trusted:
 *
 *   home page:    <div class="price-wrap">
 *                   <span class="symbol">¥</span><span class="number">14</span>
 *
 *   store page:   <div>                                  (no class at all)
 *                   <span style="…">¥</span><span style="…">5.4</span>
 *
 * So there are two sweeps: a cheap class-hinted query, then a symbol-driven
 * climb that starts from every currency symbol and walks up to the smallest
 * ancestor whose entire content is one price. The second is what makes this
 * work on markup we have never seen.
 */
function findGroupedPrices(root) {
  const out = [];
  if (!root) return out;

  const seen = new Set();
  const add = (el) => {
    if (seen.has(el)) return false;
    const item = priceInElement(el);
    if (!item) return false;
    out.push(item);
    seen.add(el);
    return true;
  };

  // 1) Class-hinted sweep — cheap, and covers the home page's price-wrap.
  if (typeof root.querySelectorAll === "function") {
    let candidates = [];
    try {
      candidates = root.querySelectorAll(
        '[class*="price" i], [class*="money" i], [class*="amount" i]',
      );
    } catch {
      candidates = [];
    }
    for (const el of candidates) add(el);
  }

  // 2) Symbol-driven climb — class-agnostic, covers the store page.
  const doc = root.ownerDocument
    ?? (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.createTreeWalker !== "function") return out;

  let walker;
  try {
    walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  } catch {
    return out;
  }

  let node;
  while ((node = walker.nextNode())) {
    const value = node.nodeValue;
    if (!value || !/[¥￥$]/.test(value)) continue;

    let el = node.parentElement;
    for (let depth = 0; el && depth < MAX_CLIMB; depth++, el = el.parentElement) {
      if (seen.has(el)) break;
      if (add(el)) break;   // smallest matching ancestor wins
    }
  }
  return out;
}

/**
 * Convert a grouped price in place, collapsing the spans into one text node.
 * Returns true when it changed something.
 */
function convertGroupedPrice(el, entry, target, options = {}) {
  const { whole = true, decimals } = options;
  const item = priceInElement(el);
  if (!item) return false;

  const value = convertAmount(entry, item.amount, item.currency, target);
  if (value === null) return false;

  el.textContent =
    `${target} ${formatAmount(value, target, { whole, decimals })}${item.tail}`;
  return true;
}

// Content scripts share one isolated-world scope, so publish the API the
// content script consumes. (`export` is not available: Chrome injects content
// scripts as classic scripts, where it is a SyntaxError.)
window.YKDPrice = {
  findPrices,
  convertPrices,
  convertAmount,
  formatAmount,
  resolveCurrency,
  findGroupedPrices,
  convertGroupedPrice,
};
