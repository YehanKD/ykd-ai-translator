/**
 * In-page notice shown when the YKD AI app is not running.
 *
 * The extension cannot start a desktop application, so the clearest thing it
 * can do is say so and get out of the way. The banner removes itself as soon
 * as the app appears — no reload, no manual retry.
 */

const BANNER_ID = "ykd-ai-banner";

function showBanner(onRetry) {
  if (document.getElementById(BANNER_ID)) return;

  const wrap = document.createElement("div");
  wrap.id = BANNER_ID;
  wrap.setAttribute("translate", "no");

  const dot = document.createElement("span");
  dot.className = "ykd-dot";

  const text = document.createElement("span");
  text.textContent =
    "YKD AI Translator is not running. Start the YKD AI app to translate this page.";

  const retry = document.createElement("button");
  retry.textContent = "Retry";
  retry.addEventListener("click", () => {
    retry.disabled = true;
    retry.textContent = "Checking…";
    onRetry?.().finally?.(() => {
      retry.disabled = false;
      retry.textContent = "Retry";
    });
  });

  const close = document.createElement("button");
  close.textContent = "×";
  close.className = "ykd-close";
  close.title = "Dismiss";
  close.addEventListener("click", () => hideBanner());

  wrap.append(dot, text, retry, close);
  document.documentElement.appendChild(wrap);
}

function hideBanner() {
  document.getElementById(BANNER_ID)?.remove();
}

function bannerVisible() {
  return Boolean(document.getElementById(BANNER_ID));
}

// Content scripts share one isolated-world scope, so publish the API the
// content script consumes.
window.YKDBanner = { showBanner, hideBanner, bannerVisible };
