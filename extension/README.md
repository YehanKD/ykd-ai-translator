# YKD AI Translator — Chrome Extension

Translates **1688.com** into English using the local YKD AI Translator desktop app.
Runs entirely on your machine: no cloud service, no API key, and no page content
leaves the computer.

![status](https://img.shields.io/badge/requires-YKD%20AI%20app%20running-0d9488)

## What it does

- **Auto-translates** every page on the sites you allowlist — 1688.com by default
- Covers product pages (specs, MOQ, price tiers), **seller chat**, search results,
  category listings, orders and after-sales pages
- Translates **what is on screen first**, then follows as you scroll
- Keeps up with live updates, so **new seller messages are translated as they arrive**
- Caches every translation, so revisiting a page is near-instant
- **Write to sellers in Chinese** — a floating button opens a small compose pebble;
  type in English, press send, and the Chinese lands in the chat box (see below)
- **See every price in your own currency** — ¥ and $ prices are converted and
  replaced with live exchange rates (see below)

## Currency conversion

1688 quotes in yuan. Pick your currency once and every price on the page shows
in it instead.

Open the extension options → **Currency**, choose from 143 currencies (each with
its flag), and press **Save**. Prices like `¥5.00` become `LKR 247`.

- Covers **product pages and the seller chat** — including a seller quoting
  `250元` in a message
- Converts **¥ (CNY) and $ (USD)** amounts
- **Replaces** the original price, so the page stays readable
- **Round to whole units** (on by default) — `¥5.00` → `LKR 247`, not `LKR 246.98`
- Rates refresh **once a day**, or press **Refresh** for the current rate
- Ranges work too: `¥5-8` → `LKR 247 – 395`

Deliberately **not** converted: bare numbers, quantities (`500件`), percentages,
dates, phone numbers, and amounts in currencies other than ¥ and $. A price with
no known rate is left exactly as written rather than showing a guessed number.
Nothing inside a text box is ever rewritten, so typing a price into the chat
composer is safe.

Rates come from free, keyless services (currency-api, with open.er-api.com as a
fallback). They are cached locally, so a failed refresh keeps working with the
last known rate.

## Writing a message to a seller

The seller chat is in Chinese, but you do not have to write in it.

1. A small teal button sits in the bottom-left of any page that has a message box.
   It is **draggable** — put it wherever suits, and it stays there.
2. Click it. A rounded panel opens with a text box.
3. Type your message in English and press **Enter** — or click **Translate & insert**.
   **Shift+Enter** makes a newline if you need more than one line.
4. The Chinese translation is placed in the site's message box.

**It does not send for you.** The text sits in the box so you can read it over,
edit it if you want, and press send yourself. That is deliberate — you are talking
to a supplier, and it is worth a glance before it goes.

If you type Chinese yourself, it is inserted as-is without translating.

The button only appears on pages that actually have a message box, so it stays out
of the way on product and search pages.

## Requirements

- The **YKD AI Translator desktop app** must be running. The extension cannot start
  it for you — an extension has no way to launch a desktop application.
- Chrome, Edge, Brave or any Chromium-based browser (Manifest V3)

When the app is not running, the extension shows a banner in the page saying so. The
banner clears by itself once you start the app — no reload needed.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this `extension/` folder
4. Start the YKD AI Translator app
5. Open any 1688.com page — it translates automatically

## Choosing which sites are translated

The extension does **nothing** on sites that are not listed. Open the extension
options (right-click the toolbar icon → *Options*, or the link in the popup):

- **Add site** — enter a domain like `detail.1688.com` or `example.com`; it is
  converted to a Chrome match pattern and Chrome asks you to confirm the permission.
- **Remove** — stop translating that site.

The default list contains only `*://*.1688.com/*`.

## How it works

```
1688.com page
   │  content script finds Chinese text nodes
   │  (visible ones first, then follows scroll)
   ▼
background service worker ──▶ cache ──▶ hit? done
   │  miss: batch up to 25 segments
   ▼
POST http://127.0.0.1:8765/v1/chat/completions
   │
   ▼
YKD AI app  ──▶  llama-server  ──▶  Hunyuan-MT-7B on your GPU
```

The content script never makes network requests. All fetching happens in the service
worker, which is not subject to CORS, so one connection and one cache serve every tab.

### Why a batch prompt instead of one request per string

A 1688 product page has hundreds of Chinese strings. One request each would be far too
slow. Segments are numbered in the prompt and parsed back by number, which the model
follows reliably. Anything it skips is retried individually, and if that also fails the
original Chinese is left in place — the extension never inserts a broken translation.

### What is deliberately left alone

Translating everything would break the site. Skipped:

- `<script>`, `<style>`, `<code>`, `<svg>`, `<canvas>`
- form controls and **`contenteditable` regions** — you type into 1688's chat box, so
  translating it would fight you
- anything marked `translate="no"` or `.notranslate`
- strings with no Chinese, and pure numbers, prices or SKUs

**Note on `<pre>`:** it is deliberately *not* skipped. 1688's chat renders every
message bubble as `<pre class="edit" contenteditable="false">`, so excluding `<pre>`
silently skipped the entire conversation. The message *input* is
`<pre contenteditable="true">`, which the contenteditable rule already protects.

### What cannot be translated

Text baked into **images** stays Chinese — the extension rewrites text nodes, and
there is no text node inside a PNG. On the chat page that means the Alibaba logo
and the Newton assistant brand mark. Everything else on screen is translated.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Auto-translate on/off | Options | On |
| Site allowlist | Options | `*://*.1688.com/*` |
| Pause on the current site | Popup | — |
| Clear translation cache | Popup | — |

## Development

```
extension/
  manifest.json
  background/
    service-worker.js   connection discovery, batching, message routing
    translate.js        prompt building and response parsing
    cache.js            persistent translation cache
  content/
    content.js          scanning, viewport priority, MutationObserver
    replace.js          safe text-node replacement and exclusion rules
    banner.js           "app not running" notice
    content.css
  popup/                status, counters, quick controls
  options/              site allowlist
  icons/
```

### Tests

```bash
# No dependencies, no browser needed
node tests/extension/translate.test.mjs    # prompt building and parsing
node tests/extension/replace.test.mjs      # DOM exclusion and replacement rules

# Requires the app running (translates a realistic 1688 page batch end to end)
node tests/extension/e2e.test.mjs
```

The e2e test sends 25 real strings — product specs and a full seller negotiation —
through the actual model and asserts that every one comes back translated and none
remain Chinese.

## Troubleshooting

**"YKD AI Translator is not running" banner**
Start the desktop app. The banner disappears on its own within a few seconds.

**Nothing happens on a page**
Check the site is in the allowlist. The extension is intentionally inert elsewhere.

**Translations stopped mid-page**
The app may have been restarted; it reconnects automatically. Check the popup's
connection dot.

**Prices or SKUs look odd**
They should never be touched. If you see one translated, please report the page —
that is a bug in the exclusion rules.

**Everything is slow on first visit**
Expected: every new string is a model call. The cache makes subsequent visits to the
same pages much faster. The popup shows how many strings are cached.

## Ports

The desktop app serves on **8765**, falling back through 8765–8774 if that port is
taken. The extension probes that range and remembers what it finds.

## Licence

MIT — see the repository root.
