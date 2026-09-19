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

render().then(checkConnection);
