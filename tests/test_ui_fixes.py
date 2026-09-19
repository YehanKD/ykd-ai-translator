"""Regression tests for the three reported UI defects.

1. Target selector must follow the detected language (Chinese input -> "English"
   shown, not "Chinese (Simplified)").
2. Flags must be real images, not the letters "CN".
3. Nav icons must be drawn images, not Unicode lookalikes.
"""

import os
import sys
import tempfile
import traceback
from pathlib import Path

os.environ["YKD_CONFIG_DIR"] = tempfile.mkdtemp(prefix="ykd-fix-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd.app import App
from ykd.icons import flag_image, icon_image, icon_png

failures = []


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def main():
    app = App()
    app.report_callback_exception = lambda *a: failures.append(f"tk: {a[1]}")
    app.withdraw()

    def stage():
        page = app._pages["Translate"]

        # --- 1. target selector follows detection -------------------------
        print("\n1) target selector follows the detected language")
        page.source.delete("1.0", "end")
        page.source.insert("1.0", "在个人资料里面 把这个开起来")
        page._on_source_changed()
        app.update()
        check("chinese input -> target shows English",
              page.tgt_picker.get() == "en", f"target={page.tgt_picker.get()!r}")
        check("effective target is en",
              page._effective_target() == "en", page._effective_target())

        page.source.delete("1.0", "end")
        page.source.insert("1.0", "The package arrived damaged.")
        page._on_source_changed()
        app.update()
        check("english input -> target shows Chinese",
              page.tgt_picker.get() == "zh", f"target={page.tgt_picker.get()!r}")

        page.source.delete("1.0", "end")
        page._on_source_changed()
        app.update()
        check("empty input -> target back to Chinese",
              page.tgt_picker.get() == "zh", f"target={page.tgt_picker.get()!r}")

        # --- 2. flags are images ------------------------------------------
        print("\n2) flags are real images")
        for code in ("zh", "en", "ja", "ta", "kk"):
            img = flag_image(code, 14)
            check(f"flag image for {code}", img is not None)
        check("no 'CN' text in the selector label",
              "CN" not in page.tgt_picker._label(), page.tgt_picker._label())
        check("no regional-indicator chars in label",
              not any(0x1F1E6 <= ord(c) <= 0x1F1FF for c in page.tgt_picker._label()),
              repr(page.tgt_picker._label()))

        # --- 3. nav icons are drawn images ---------------------------------
        print("\n3) nav icons are drawn images")
        for nm in ("translate", "history", "settings"):
            check(f"icon image for {nm}", icon_image(nm, 15, "#cacacd") is not None)
            im = icon_png(nm, 32, "#cacacd")
            # a real drawing has varied alpha, not an empty or solid square
            alphas = {im.getpixel((x, y))[3] for x in range(0, 32, 4) for y in range(0, 32, 4)}
            check(f"{nm} icon has content", len(alphas) > 1, f"{len(alphas)} alpha levels")
        for label, btn in app._nav_buttons.items():
            check(f"nav '{label}' has an image", btn.cget("image") not in ("", None))

        # --- regressions still hold ----------------------------------------
        print("\n4) earlier regressions still pass")
        check("engine states wired", app.status_text.cget("text") != "")
        check("3 pages", len(app._pages) == 3)

        app.quit()

    app.after(400, stage)
    app.mainloop()

    print()
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL FIX CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
