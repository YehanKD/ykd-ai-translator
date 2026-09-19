/**
 * Persistent translation cache.
 *
 * 1688 repeats the same strings constantly — "起批量", "现货", seller names,
 * category labels. Caching turns a second visit to any page into a near-instant
 * one, and keeps the model free for text it has not seen.
 *
 * Keys are a short hash of the source text plus the target language, so the
 * stored JSON stays compact.
 */

const KEY_PREFIX = "t:";
const MAX_ENTRIES = 20000;
const TRIM_TO = 16000;          // trim down to this once MAX_ENTRIES is passed

/** Fast, stable 32-bit hash — collisions are harmless here (worst case: a
 *  wrong translation is shown for one string, and the text is the value). */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function key(text, target) {
  return KEY_PREFIX + hash(target + "\u0000" + text);
}

/**
 * Look up many strings at once. One storage round-trip per batch, not per item.
 * Returns a Map of source text -> translation for the entries that were found.
 */
export async function getMany(texts, target) {
  const wanted = new Map();      // storage key -> source text
  for (const t of texts) wanted.set(key(t, target), t);

  const keys = [...wanted.keys()];
  if (keys.length === 0) return new Map();

  let stored;
  try {
    stored = await chrome.storage.local.get(keys);
  } catch {
    return new Map();
  }

  const found = new Map();
  for (const [k, value] of Object.entries(stored)) {
    const source = wanted.get(k);
    if (source !== undefined && typeof value === "string" && value) {
      found.set(source, value);
    }
  }
  return found;
}

/** Store several source -> translation pairs in one round-trip. */
export async function putMany(pairs, target) {
  if (pairs.length === 0) return;
  const payload = {};
  for (const [source, translation] of pairs) {
    if (!source || !translation) continue;
    payload[key(source, target)] = translation;
  }
  if (Object.keys(payload).length === 0) return;
  try {
    await chrome.storage.local.set(payload);
  } catch {
    // A full or unavailable store must never break translation.
  }
}

/** Remove entries so the cache cannot grow without bound. */
export async function trim() {
  let all;
  try {
    all = await chrome.storage.local.get(null);
  } catch {
    return 0;
  }
  const ours = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
  if (ours.length <= MAX_ENTRIES) return 0;

  // chrome.storage does not preserve insertion order for our purposes, so
  // evict an arbitrary slice — the cache is a pure optimisation, and a
  // re-translation costs one request.
  const excess = ours.slice(0, ours.length - TRIM_TO);
  try {
    await chrome.storage.local.remove(excess);
  } catch {
    return 0;
  }
  return excess.length;
}

export async function stats() {
  let all;
  try {
    all = await chrome.storage.local.get(null);
  } catch {
    return { entries: 0 };
  }
  return {
    entries: Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX)).length,
  };
}

export async function clear() {
  let all;
  try {
    all = await chrome.storage.local.get(null);
  } catch {
    return 0;
  }
  const ours = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
  if (ours.length) await chrome.storage.local.remove(ours);
  return ours.length;
}
