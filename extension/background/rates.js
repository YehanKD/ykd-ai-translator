/**
 * Exchange rates, cached in chrome.storage.local.
 *
 * Two independent free providers, neither needing an API key:
 *   1. currency-api  — a static JSON file on a CDN, ~340 codes, daily
 *   2. open.er-api.com — live rates, ~166 codes
 *
 * Rates are stored with the day they were fetched, so a stale cache is
 * detectable and the UI can say how old the number is. A failed refresh never
 * clears a good cache: showing yesterday's rate beats showing nothing.
 */

const CACHE_KEY = "rates";
const BASE = "CNY";                 // 1688 quotes in yuan
const FRESH_MS = 24 * 60 * 60 * 1000;

const PROVIDERS = [
  {
    name: "currency-api",
    url: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${BASE.toLowerCase()}.json`,
    // { date: "2026-09-19", cny: { lkr: 49.4, ... } }
    parse: (data) => ({
      date: data?.date ?? null,
      rates: data?.[BASE.toLowerCase()] ?? null,
    }),
  },
  {
    name: "open.er-api.com",
    url: `https://open.er-api.com/v6/latest/${BASE}`,
    // { result: "success", time_last_update_unix: 123, rates: { LKR: 49.5 } }
    parse: (data) => {
      if (data?.result !== "success" || !data?.rates) return null;
      const stamp = data.time_last_update_unix
        ? new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10)
        : null;
      return { date: stamp, rates: data.rates };
    },
  },
];

/** Uppercase every key so lookups are case-insensitive across providers. */
function normalise(rates) {
  if (!rates || typeof rates !== "object") return null;
  const out = {};
  for (const [code, value] of Object.entries(rates)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) out[code.toUpperCase()] = n;
  }
  return Object.keys(out).length ? out : null;
}

async function readCache() {
  try {
    const { [CACHE_KEY]: cached } = await chrome.storage.local.get(CACHE_KEY);
    return cached ?? null;
  } catch {
    return null;
  }
}

async function writeCache(entry) {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: entry });
  } catch {
    // Storage full or unavailable; rates still work for this session.
  }
}

function isFresh(entry) {
  return Boolean(entry?.fetchedAt) && Date.now() - entry.fetchedAt < FRESH_MS;
}

/**
 * Fetch from each provider in turn. Returns a cache entry, or null if every
 * provider failed (in which case any existing cache is left untouched).
 */
export async function fetchRates() {
  for (const provider of PROVIDERS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let data;
      try {
        const res = await fetch(provider.url, { signal: controller.signal });
        if (!res.ok) continue;
        data = await res.json();
      } finally {
        clearTimeout(timer);
      }

      const parsed = provider.parse(data);
      const rates = normalise(parsed?.rates);
      if (!rates || !rates[BASE]) continue;

      const entry = {
        base: BASE,
        rates,
        date: parsed.date,
        provider: provider.name,
        fetchedAt: Date.now(),
      };
      await writeCache(entry);
      return entry;
    } catch {
      // Try the next provider.
    }
  }
  return null;
}

/**
 * Rates for conversion, refreshing when the cache is stale.
 *
 * `force` is for the manual Refresh button. When a refresh fails but a stale
 * cache exists, the stale entry is returned rather than nothing.
 */
export async function getRates({ force = false } = {}) {
  const cached = await readCache();
  if (!force && isFresh(cached)) return cached;

  const fresh = await fetchRates();
  if (fresh) return fresh;
  return cached ?? null;
}

/** When the cached rates were fetched, for display. */
export async function ratesInfo() {
  const cached = await readCache();
  if (!cached) return null;
  return {
    provider: cached.provider,
    date: cached.date,
    fetchedAt: cached.fetchedAt,
    stale: !isFresh(cached),
    count: Object.keys(cached.rates ?? {}).length,
  };
}

/**
 * Convert an amount from the base currency into `code`.
 * Returns null when the rate is unknown, so callers leave the price alone
 * rather than printing a wrong number.
 */
export function convert(entry, amount, code) {
  if (!entry?.rates || !code) return null;
  const rate = entry.rates[String(code).toUpperCase()];
  if (!Number.isFinite(rate)) return null;
  const value = Number(amount) * rate;
  return Number.isFinite(value) ? value : null;
}
