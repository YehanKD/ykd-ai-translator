/**
 * Options: which sites the extension auto-activates on, plus behaviour.
 *
 * The allowlist is the activation boundary: the extension does nothing on any
 * site that is not listed. Adding a domain requires a permission grant, which
 * Chrome prompts for — that prompt is the user's confirmation.
 */

const DEFAULT_PATTERNS = ["*://*.1688.com/*"];
const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (reply) => {
      if (chrome.runtime.lastError) resolve({ ok: false });
      else resolve(reply ?? { ok: false });
    });
  });
}

function msg(text, kind = "") {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg" + (kind ? " " + kind : "");
  if (text) setTimeout(() => { el.textContent = ""; }, 4000);
}

/** A Chrome match pattern needs scheme://host/path. */
function validPattern(p) {
  return /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)\/.*$/.test(p.trim());
}

/** Turn a bare domain into a usable pattern. */
function normalise(input) {
  let p = input.trim();
  if (!p) return "";
  if (!p.includes("://")) p = `*://*.${p.replace(/^\*\./, "")}`;
  if (!/\/\*?$/.test(p)) p = p.replace(/\/?$/, "/*");
  return p;
}

async function getPatterns() {
  const { patterns } = await chrome.storage.sync.get("patterns");
  return Array.isArray(patterns) && patterns.length ? patterns : [...DEFAULT_PATTERNS];
}

async function setPatterns(patterns) {
  await chrome.storage.sync.set({ patterns });
  await registerScripts(patterns);
}

/**
 * Register content scripts for each allowed pattern.
 *
 * The manifest's static content script covers 1688.com; anything the user adds
 * is registered dynamically so a new site works without reinstalling.
 */
async function registerScripts(patterns) {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ids = existing.filter((s) => s.id.startsWith("ykd-site-")).map((s) => s.id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });

  const extra = patterns.filter((p) => !/1688\.com/.test(p));
  if (extra.length === 0) return;

  await chrome.scripting.registerContentScripts(
    extra.map((pattern, i) => ({
      id: `ykd-site-${i}`,
      matches: [pattern],
      js: ["content/replace.js", "content/banner.js", "content/content.js"],
      css: ["content/content.css"],
      runAt: "document_idle",
      allFrames: true,
    })),
  );
}

async function render() {
  const patterns = await getPatterns();
  const list = $("list");
  list.innerHTML = "";

  for (const pattern of patterns) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = pattern;

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      const next = (await getPatterns()).filter((p) => p !== pattern);
      if (next.length === 0) {
        msg("Keep at least one site.", "err");
        return;
      }
      await setPatterns(next);
      await render();
      msg("Removed.", "ok");
    });

    li.append(span, remove);
    list.appendChild(li);
  }

  const { enabled = true } = await chrome.storage.sync.get("enabled");
  $("toggleEnabled").textContent = enabled ? "On" : "Off";
}

$("add").addEventListener("click", async () => {
  const raw = $("pattern").value;
  const pattern = normalise(raw);
  if (!validPattern(pattern)) {
    msg("That does not look like a valid site pattern.", "err");
    return;
  }

  // Ask Chrome for permission to run on the new origin.
  const origin = pattern.match(/^(\*|https?):\/\/([^/]+)/);
  if (origin) {
    const host = origin[2].replace(/^\*\./, "");
    const granted = await chrome.permissions.request({
      origins: [`*://*.${host}/*`, `*://${host}/*`],
    });
    if (!granted) {
      msg("Permission was not granted for that site.", "err");
      return;
    }
  }

  const patterns = await getPatterns();
  if (patterns.includes(pattern)) {
    msg("Already in the list.");
    return;
  }
  await setPatterns([...patterns, pattern]);
  $("pattern").value = "";
  await render();
  msg("Added. Open a page on that site to translate it.", "ok");
});

$("toggleEnabled").addEventListener("click", async () => {
  const { enabled = true } = await chrome.storage.sync.get("enabled");
  await send("setEnabled", { enabled: !enabled });
  await render();
});

$("recheck").addEventListener("click", async () => {
  $("conn").textContent = "Checking…";
  const reply = await send("ensureConnected");
  $("conn").textContent = reply?.ok
    ? `Local model ready (port ${reply.state?.port})`
    : "YKD AI app is not running";
});

async function checkConnection() {
  const reply = await send("stats");
  $("conn").textContent = reply?.state?.connected
    ? `Local model ready (port ${reply.state.port})`
    : "YKD AI app is not running";
}

// ------------------------------------------------------------------ currency

// currencies.data.js is loaded by options.html before this file and publishes
// window.YKDCurrency. An `import` here would be a SyntaxError: options.js is a
// classic script, not a module, so a bare import kills the entire page.
//
// Do NOT destructure these into top-level consts either. Classic scripts share
// one top-level scope, so any name the data file already declared (CURRENCIES,
// DEFAULT_CURRENCY, findCurrency…) collides and throws "already been declared".
// Reading them off the namespace keeps this file's scope clean.
const CURRENCY = window.YKDCurrency;

function currencyMsg(text, kind = "") {
  const el = $("curMsg");
  el.textContent = text;
  el.className = "msg" + (kind ? " " + kind : "");
  if (text) setTimeout(() => { el.textContent = ""; }, 6000);
}

/** "🇱🇰 Sri Lankan Rupee (LKR)" — flag first so the list scans visually. */
function fillCurrencies(selected) {
  const select = $("currency");
  select.textContent = "";
  for (const c of CURRENCY.CURRENCIES) {
    const option = document.createElement("option");
    option.value = c.code;
    option.textContent = `${c.flag} ${c.name} (${c.code})`;
    select.appendChild(option);
  }
  select.value = selected && CURRENCY.findCurrency(selected) ? selected : CURRENCY.DEFAULT_CURRENCY;
}

/** "1 CNY = 49.41 LKR · updated today · currency-api" */
function describeRates(info, currency) {
  if (!info) return "No rates yet — press Refresh.";
  const el = $("rateInfo");
  const age = info.fetchedAt
    ? Math.round((Date.now() - info.fetchedAt) / 3600000)
    : null;
  let when = "just now";
  if (age !== null) {
    if (age < 1) when = "just now";
    else if (age < 24) when = `${age}h ago`;
    else when = `${Math.round(age / 24)}d ago`;
  }
  const stale = info.stale ? " (stale)" : "";
  const rate = currency ? `1 CNY ≈ ${info.rate ?? "?"} ${currency} · ` : "";
  el.textContent = `${rate}updated ${when}${stale} · ${info.provider ?? "?"}`;
}

async function loadCurrency() {
  const info = await send("currencyInfo");
  const currency = info?.currency ?? CURRENCY.DEFAULT_CURRENCY;

  fillCurrencies(currency);

  const convert = info?.convertPrices !== false;
  $("togglePrices").textContent = convert ? "On" : "Off";

  const round = info?.roundWhole !== false;
  $("toggleRound").textContent = round ? "On" : "Off";

  // Show the live rate for the selected currency.
  const rate = info?.rates?.[currency] ?? null;
  describeRates({ ...(info?.info ?? {}), rate }, currency);
}

$("saveCurrency").addEventListener("click", async () => {
  const currency = $("currency").value;
  if (!currency) {
    currencyMsg("Pick a currency first.", "err");
    return;
  }
  const reply = await send("setCurrency", { currency });
  if (!reply?.ok) {
    currencyMsg("Could not save the currency.", "err");
    return;
  }
  const info = await send("currencyInfo");
  const c = CURRENCY.findCurrency(currency);
  describeRates({ ...(info?.info ?? {}), rate: info?.rates?.[currency] ?? null }, currency);
  currencyMsg(`Saved. Prices will show in ${c?.flag ?? ""} ${currency}.`, "ok");
});

$("togglePrices").addEventListener("click", async () => {
  const { convertPrices = true } = await chrome.storage.sync.get("convertPrices");
  await send("setConvertPrices", { convertPrices: !convertPrices });
  await loadCurrency();
});

$("toggleRound").addEventListener("click", async () => {
  const { roundWhole = true } = await chrome.storage.sync.get("roundWhole");
  await send("setRoundWhole", { roundWhole: !roundWhole });
  await loadCurrency();
});

$("refreshRates").addEventListener("click", async () => {
  const button = $("refreshRates");
  button.disabled = true;
  $("rateInfo").textContent = "Fetching…";
  try {
    const reply = await send("refreshRates");
    if (!reply?.ok) {
      currencyMsg(reply?.error || "Could not fetch rates.", "err");
      $("rateInfo").textContent = "Refresh failed.";
      return;
    }
    const currency = $("currency").value;
    const info = await send("currencyInfo");
    describeRates(
      { ...(reply.info ?? {}), rate: info?.rates?.[currency] ?? null },
      currency,
    );
    currencyMsg("Exchange rates updated.", "ok");
  } finally {
    button.disabled = false;
  }
});

render().then(checkConnection).then(loadCurrency);
