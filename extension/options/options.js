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
  // Only auto-clear terminal messages. Clearing a "waiting…" notice while the
  // permission prompt is still open would leave the page looking dead.
  if (text && kind) {
    clearTimeout(msg._timer);
    msg._timer = setTimeout(() => { el.textContent = ""; }, 4000);
  }
}

/**
 * A Chrome match pattern needs scheme://host/path.
 *
 * The host is a real hostname (or `*` / `*.host`), so whitespace and other
 * non-hostname characters are rejected. Without this, free text like
 * "!!! not a url !!!" normalised into a "valid" pattern and was added.
 */
function validPattern(p) {
  const trimmed = p.trim();
  if (!/^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)\/.*$/.test(trimmed)) return false;
  const host = trimmed.match(/^(\*|https?):\/\/([^/]+)/)?.[2] ?? "";
  // Letters, digits, dots and hyphens only (plus a leading *.).
  return /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(host);
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
 * The scripts a translated site needs, in load order.
 *
 * Read from the manifest rather than hard-coded, so a newly added site gets
 * exactly the same content scripts as 1688 — including the currencies data and
 * the price converter. Hard-coding a shorter list here silently gave added
 * sites a partial feature set (no price conversion, no compose pebble).
 */
function contentScriptFiles() {
  const fromManifest = chrome.runtime.getManifest()
    .content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
  if (fromManifest.length) return fromManifest;
  // Fallback for an unexpected manifest shape.
  return ["content/replace.js", "content/banner.js", "content/compose.js",
          "content/content.js", "content/pebble.js"];
}

/** The stylesheet a translated site needs. */
function contentScriptCss() {
  return chrome.runtime.getManifest()
    .content_scripts?.flatMap((cs) => cs.css ?? []) ?? [];
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

  const js = contentScriptFiles();
  const css = contentScriptCss();

  await chrome.scripting.registerContentScripts(
    extra.map((pattern, i) => ({
      id: `ykd-site-${i}`,
      matches: [pattern],
      js,
      css,
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

/**
 * Ask Chrome for permission to run on a host, returning a result object.
 *
 * Two rules that are easy to get wrong and both produce a silent failure:
 *
 *  - `chrome.permissions.request` only works inside a user gesture, so it must
 *    be called synchronously from the click handler — before any `await`.
 *  - the origin must be covered by the manifest's `optional_host_permissions`.
 *    A wildcard-scheme pattern requires a wildcard-scheme entry there;
 *    declaring only http and https separately does NOT cover it, and Chrome
 *    rejects with "Only permissions specified in the manifest may be
 *    requested." (Note: writing that pattern literally inside a block comment
 *    is impossible — it contains the comment terminator.)
 *
 * The caller must also await this and report the outcome, or a rejection
 * surfaces as "nothing happened".
 */
function requestOrigin(host) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    try {
      const request = chrome.permissions.request({
        origins: [`*://*.${host}/*`, `*://${host}/*`],
      });
      if (!request || typeof request.then !== "function") {
        finish({ granted: false, error: "Permission request unavailable." });
        return;
      }
      request.then(
        (granted) => finish({ granted: Boolean(granted) }),
        (err) => finish({ granted: false, error: String(err?.message ?? err) }),
      );
    } catch (err) {
      finish({ granted: false, error: String(err?.message ?? err) });
    }

    // If Chrome never resolves (rare, but it happens when the prompt is
    // suppressed), do not leave the button dead forever.
    setTimeout(() => finish({ granted: false, error: "Permission request timed out." }), 60000);
  });
}

$("add").addEventListener("click", async () => {
  try {
    const raw = $("pattern").value;
    const pattern = normalise(raw);
    if (!validPattern(pattern)) {
      msg("That does not look like a valid site pattern. Try example.com or https://example.com/*", "err");
      return;
    }

    const origin = pattern.match(/^(\*|https?):\/\/([^/]+)/);
    const host = origin ? origin[2].replace(/^\*\./, "") : null;

    // `chrome.permissions.request` must be the FIRST await in this handler.
    // Any await before it (even `permissions.contains`) consumes the user
    // gesture, after which request() never resolves and never throws — the
    // button just looks dead. When the permission is already granted Chrome
    // resolves request() immediately without showing a prompt, so there is
    // nothing to pre-check.
    if (host) {
      // Tell the user something is happening BEFORE awaiting: the permission
      // prompt is native browser UI, and while it is open this handler is
      // suspended. Without this line the button looks dead.
      msg(`Waiting for permission for ${host}…`);
      $("add").disabled = true;
      let result;
      try {
        result = await requestOrigin(host);
      } finally {
        $("add").disabled = false;
      }

      if (!result.granted) {
        msg(
          result.error
            ? `Could not add the site: ${result.error}`
            : "Permission was not granted for that site.",
          "err",
        );
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
  } catch (err) {
    // Without this, any rejection makes the button look dead.
    msg(`Could not add the site: ${String(err?.message ?? err)}`, "err");
  }
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
