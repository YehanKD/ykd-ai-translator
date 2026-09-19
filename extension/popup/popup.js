/** Toolbar popup: connection state, counters, and quick controls. */

const $ = (id) => document.getElementById(id);

async function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (reply) => {
      if (chrome.runtime.lastError) resolve({ ok: false });
      else resolve(reply ?? { ok: false });
    });
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function renderStatus(state) {
  const dot = $("dot");
  const text = $("status");
  if (state?.connected) {
    dot.classList.add("ok");
    text.textContent = `Local model ready (port ${state.port})`;
  } else {
    dot.classList.remove("ok");
    text.textContent = state?.lastError
      ? "App not reachable"
      : "YKD AI app is not running";
  }
  $("translated").textContent = state?.translated ?? 0;
  $("cached").textContent = state?.cacheHits ?? 0;
}

async function refresh() {
  const reply = await send("stats");
  renderStatus(reply?.state);
  if (reply?.cache) {
    $("cacheline").textContent = `${reply.cache.entries} strings cached`;
  }

  const { enabled = true } = await chrome.storage.sync.get("enabled");
  $("toggle").textContent = enabled ? "Pause on this site" : "Resume on this site";

  const tab = await activeTab();
  const on1688 = Boolean(tab?.url && /1688\.com/.test(tab.url));
  $("rescan").disabled = !on1688;
  if (!on1688) {
    $("status").textContent = "Open a 1688.com page to translate";
    $("dot").classList.remove("ok");
  }
}

$("toggle").addEventListener("click", async () => {
  const { enabled = true } = await chrome.storage.sync.get("enabled");
  await send("setEnabled", { enabled: !enabled });
  await refresh();
});

$("rescan").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id !== undefined) {
    chrome.tabs.sendMessage(tab.id, { type: "ykd:rescan" }).catch(() => {});
  }
});

$("clearcache").addEventListener("click", async (e) => {
  e.preventDefault();
  const reply = await send("clearCache");
  $("cacheline").textContent = `Cleared ${reply?.removed ?? 0} cached strings`;
  await refresh();
});

$("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
