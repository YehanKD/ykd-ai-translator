/**
 * Background service worker.
 *
 * Owns everything that talks to the local YKD AI app:
 *   - discovers the server port (8765-8774, or the published port file)
 *   - translates batches, with a persistent cache in front
 *   - reports connection state to content scripts and the popup
 *
 * Content scripts never fetch directly: a service worker with host_permissions
 * is not subject to CORS, and centralising here means one cache and one
 * connection state for every tab.
 */

import { buildPrompt, parseBatch, makeBatches } from "./translate.js";
import * as cache from "./cache.js";
import * as rates from "./rates.js";

const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 8765 + i);
const HEALTH_TIMEOUT_MS = 1500;
const REQUEST_TIMEOUT_MS = 60000;

/** Currently known-good base URL, e.g. "http://127.0.0.1:8765". */
let baseUrl = null;

/** Bumped whenever the connection state changes, so the popup can react. */
const state = {
  connected: false,
  port: null,
  translated: 0,
  cacheHits: 0,
  lastError: null,
};

// ---------------------------------------------------------------- discovery

async function probe(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find the running server. Tries the remembered base first, then the port
 * range. Cheap enough to call on every reconnect.
 */
export async function discover() {
  if (baseUrl && (await probe(baseUrl))) {
    setConnected(true, Number(new URL(baseUrl).port));
    return baseUrl;
  }

  for (const port of PORT_RANGE) {
    const candidate = `http://127.0.0.1:${port}`;
    if (await probe(candidate)) {
      baseUrl = candidate;
      setConnected(true, port);
      return baseUrl;
    }
  }

  baseUrl = null;
  setConnected(false, null);
  return null;
}

function setConnected(connected, port, error = null) {
  const changed = state.connected !== connected || state.port !== port;
  state.connected = connected;
  state.port = port;
  state.lastError = error;
  if (changed) broadcast({ type: "ykd:state", state: publicState() });
}

export function publicState() {
  return {
    connected: state.connected,
    port: state.port,
    translated: state.translated,
    cacheHits: state.cacheHits,
    lastError: state.lastError,
  };
}

function broadcast(message) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tabs without our content script simply have no listener.
      });
    }
  });
}

// -------------------------------------------------------------- translation

async function translateBatch(segments, target) {
  const body = {
    messages: [{ role: "user", content: buildPrompt(segments, target) }],
    temperature: 0.3,
    max_tokens: 2048,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate a list of strings, using the cache and retrying anything the model
 * omitted. Always returns an array aligned with the input; an entry is `null`
 * only when every attempt failed, so the caller can leave the original text.
 */
export async function translateTexts(texts, target = "English") {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  if (!state.connected || !baseUrl) {
    const found = await discover();
    if (!found) throw new Error("YKD AI app is not running");
  }

  const results = new Array(texts.length).fill(null);

  // 1. cache
  const cached = await cache.getMany(texts, target);
  const pending = [];
  texts.forEach((text, i) => {
    if (cached.has(text)) {
      results[i] = cached.get(text);
      state.cacheHits++;
    } else {
      pending.push(i);
    }
  });
  if (pending.length === 0) {
    broadcast({ type: "ykd:state", state: publicState() });
    return results;
  }

  // 2. translate the misses, in batches
  const uniquePending = [...new Set(pending.map((i) => texts[i]))];
  const toStore = [];

  for (const batch of makeBatches(uniquePending)) {
    let parsed;
    try {
      parsed = parseBatch(await translateBatch(batch, target), batch.length);
    } catch (err) {
      setConnected(false, state.port, String(err.message ?? err));
      throw err;
    }

    // 3. retry anything the model skipped, one at a time
    for (let j = 0; j < batch.length; j++) {
      let value = parsed[j];
      if (!value) {
        try {
          const single = parseBatch(
            await translateBatch([batch[j]], target), 1);
          value = single[0];
        } catch {
          value = null;
        }
      }
      if (value) toStore.push([batch[j], value]);
    }
  }

  const storeMap = new Map(toStore);
  for (const i of pending) {
    const value = storeMap.get(texts[i]);
    if (value) {
      results[i] = value;
      state.translated++;
    }
  }

  await cache.putMany(toStore, target);
  cache.trim().catch(() => {});
  broadcast({ type: "ykd:state", state: publicState() });
  return results;
}

// ------------------------------------------------------------------ messages

const handlers = {
  async ping() {
    return { ok: true, state: publicState() };
  },

  async ensureConnected() {
    if (state.connected) return { ok: true, state: publicState() };
    const found = await discover();
    return { ok: Boolean(found), state: publicState() };
  },

  async translate({ texts, target }) {
    try {
      const translations = await translateTexts(texts, target);
      return { ok: true, translations, state: publicState() };
    } catch (err) {
      return { ok: false, error: String(err.message ?? err), state: publicState() };
    }
  },

  async state() {
    return { ok: true, state: publicState() };
  },

  async stats() {
    const cacheStats = await cache.stats();
    return { ok: true, state: publicState(), cache: cacheStats };
  },

  async clearCache() {
    const removed = await cache.clear();
    state.translated = 0;
    state.cacheHits = 0;
    broadcast({ type: "ykd:state", state: publicState() });
    return { ok: true, removed };
  },

  async setEnabled({ enabled }) {
    await chrome.storage.sync.set({ enabled: Boolean(enabled) });
    broadcast({ type: "ykd:enabled", enabled: Boolean(enabled) });
    return { ok: true, enabled: Boolean(enabled) };
  },

  async getEnabled() {
    const { enabled = true } = await chrome.storage.sync.get("enabled");
    return { ok: true, enabled };
  },

  // -------------------------------------------------------------- currency

  /** Current preference + rates, for content scripts and the options page. */
  async currencyInfo({ force = false } = {}) {
    const { currency = null, convertPrices = true, roundWhole = true } =
      await chrome.storage.sync.get(["currency", "convertPrices", "roundWhole"]);
    const entry = await rates.getRates({ force });
    const info = await rates.ratesInfo();
    return {
      ok: true,
      currency,
      convertPrices: convertPrices !== false,
      roundWhole: roundWhole !== false,
      base: entry?.base ?? "CNY",
      rates: entry?.rates ?? null,
      info,
    };
  },

  /** Manual refresh from the options page. */
  async refreshRates() {
    const entry = await rates.fetchRates();
    if (!entry) {
      return { ok: false, error: "Could not reach any exchange-rate service." };
    }
    const info = await rates.ratesInfo();
    broadcast({ type: "ykd:rates", info });
    return { ok: true, info };
  },

  async setCurrency({ currency }) {
    await chrome.storage.sync.set({ currency: currency || null });
    broadcast({ type: "ykd:currency", currency: currency || null });
    return { ok: true, currency };
  },

  async setConvertPrices({ convertPrices }) {
    await chrome.storage.sync.set({ convertPrices: Boolean(convertPrices) });
    broadcast({ type: "ykd:currency", convertPrices: Boolean(convertPrices) });
    return { ok: true, convertPrices: Boolean(convertPrices) };
  },

  async setRoundWhole({ roundWhole }) {
    await chrome.storage.sync.set({ roundWhole: Boolean(roundWhole) });
    broadcast({ type: "ykd:currency", roundWhole: Boolean(roundWhole) });
    return { ok: true, roundWhole: Boolean(roundWhole) };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }));
  return true;                       // keep the channel open for the async reply
});

// --------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(() => {
  discover().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  discover().catch(() => {});
});

// Re-check periodically so a restarted app is noticed without a page reload.
// The worker is only alive while a tab needs it, so a plain interval is
// sufficient and avoids needing the "alarms" permission.
let healthTimer = null;
function startHealthLoop() {
  if (healthTimer !== null) return;
  healthTimer = setInterval(() => {
    discover().catch(() => {});
  }, 5000);
}
startHealthLoop();

discover().catch(() => {});
