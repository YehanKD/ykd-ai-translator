"""GUI smoke test — builds the real app, drives the real engine, no display assumptions.

Verifies:
  * every page constructs
  * the engine reaches READY and the status indicator updates
  * a translation through the UI lands in the output box and in history
  * a forced engine failure leaves the button ENABLED (the old wedged-UI bug)

Run: build-venv/bin/python tests/test_gui_live.py
"""

import os
import sys
import tempfile
import time
from pathlib import Path

# Isolate the test from the real user config BEFORE importing ykd.
_TMP_CFG = tempfile.mkdtemp(prefix="ykd-test-cfg-")
os.environ["YKD_CONFIG_DIR"] = _TMP_CFG

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd.app import App
from ykd.engine import STATE_FAILED, STATE_READY

failures: list[str] = []


def check(label: str, condition: bool, detail: str = ""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}{(' — ' + detail) if detail else ''}")
    if not condition:
        failures.append(label)


def main() -> int:
    app = App()
    app.report_callback_exception = lambda *a: failures.append(f"tk-callback: {a[1]}")
    app.withdraw()  # do not flash a window during the test

    result = {}

    def phase1():
        check("pages constructed", set(app._pages) == {"Translate", "History", "Settings"})
        check("nav buttons", len(app._nav_buttons) == 3)
        app.engine.start()
        app.after(500, phase2)

    def phase2():
        if app.engine.state not in (STATE_READY, STATE_FAILED):
            app.after(500, phase2)
            return
        check("engine ready", app.engine.state == STATE_READY,
              f"state={app.engine.state} err={app.engine.last_error}")
        check("status label shows ready", "Ready" in app.status_text.cget("text"),
              app.status_text.cget("text"))

        page = app._pages["Translate"]
        page.source.delete("1.0", "end")
        page.source.insert("1.0", "The package arrived damaged, so I need a refund.")
        page._on_source_changed()
        check("counter updated", "/" in page.counter.cget("text"), page.counter.cget("text"))
        check("effective target defaults to zh", page._effective_target() == "zh",
              page._effective_target())

        before = len(app.cfg.get("history", []))
        result["history_before"] = before
        page.translate()
        app.after(500, phase3)

    def phase3():
        page = app._pages["Translate"]
        if page.busy:
            app.after(500, phase3)
            return
        out = page.output.get("1.0", "end").strip()
        check("translation produced", bool(out) and out != "…", out[:50])
        check("output is Chinese", any("\u4e00" <= c <= "\u9fff" for c in out), out[:50])
        check("button re-enabled", page.go.cget("state") == "normal",
              str(page.go.cget("state")))
        check("history recorded", len(app.cfg.get("history", [])) > result["history_before"],
              f"{result['history_before']} -> {len(app.cfg.get('history', []))}")

        # --- the regression that used to wedge the UI ---
        original = app.engine.translate

        def boom(*_a, **_k):
            raise RuntimeError("simulated backend failure")

        app.engine.translate = boom
        page.source.delete("1.0", "end")
        page.source.insert("1.0", "trigger a failure")
        page._on_source_changed()
        page.translate()
        app.after(700, lambda: phase4(original))

    def phase4(original):
        page = app._pages["Translate"]
        app.engine.translate = original
        out = page.output.get("1.0", "end").strip()
        check("error surfaced to user", "[Error]" in out, out[:60])
        check("button NOT wedged after error", page.go.cget("state") == "normal",
              str(page.go.cget("state")))
        check("busy flag cleared", page.busy is False)

        # zh auto-detect should flip the target to English
        page.source.delete("1.0", "end")
        page.source.insert("1.0", "包裹损坏了，我需要退款。")
        page._on_source_changed()
        check("zh detected -> target en", page._effective_target() == "en",
              page._effective_target())

        # theme switch
        app.set_theme("light")
        check("light theme applied", app.T["accent"] == "#0d9488", app.T["accent"])
        app.set_theme("dark")

        app.engine.stop()
        app.quit()

    app.after(300, phase1)
    app.mainloop()

    print()
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL GUI CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
