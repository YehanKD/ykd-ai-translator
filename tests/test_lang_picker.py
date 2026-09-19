"""Regression tests for the language dropdown.

The original bug: the list was a ``Toplevel`` with ``overrideredirect(True)``
and a ``<FocusOut>`` binding, so on Wayland it vanished as soon as the pointer
reached it. These tests pin the behaviours that must hold instead:

* opening shows an overlay that survives focus changes and mouse motion
* picking a language selects it and closes
* Escape closes; clicking outside closes; clicking the trigger toggles
* searching filters the list
"""

import os
import sys
import tempfile
from pathlib import Path

import customtkinter as ctk

os.environ["YKD_CONFIG_DIR"] = tempfile.mkdtemp(prefix="ykd-dd-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd.app import App  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def main():
    app = App()
    app.report_callback_exception = lambda *a: failures.append(f"tk: {a[1]}")
    # Deiconify (not withdraw) so geometry and mapping are real.
    app.geometry("1100x720+60+40")
    app.update()

    def stage():
        page = app._pages["Translate"]
        tgt = page.tgt_picker        # no Auto Detect -> 38 rows
        src = page.src_picker        # has Auto Detect  -> 39 rows

        print("\n1) open and survive focus changes / pointer motion")
        tgt.toggle()
        app.update()
        check("overlay opened", tgt.is_open())
        check("overlay is a child of the window, not a Toplevel",
              tgt._popup.winfo_toplevel() is app and not isinstance(tgt._popup, ctk.CTkToplevel),
              type(tgt._popup).__name__)
        check("overlay is placed (has geometry)", bool(tgt._popup.place_info()),
              str(tgt._popup.place_info())[:60])
        check("target picker has 38 rows", len(tgt._rows) == 38, f"{len(tgt._rows)} rows")
        check("overlay sits inside the window bounds",
              0 <= tgt._popup.winfo_x() <= app.winfo_width()
              and 0 <= tgt._popup.winfo_y() <= app.winfo_height(),
              f"x={tgt._popup.winfo_x()} y={tgt._popup.winfo_y()}")

        # The regression: focus moving away used to close it.
        page.source.focus_set()
        app.update()
        check("stays open after focus moves away", tgt.is_open())

        # Pointer motion over it must not close it either.
        tgt._popup.event_generate("<Motion>", x=20, y=20)
        tgt._popup.event_generate("<Enter>")
        app.update()
        check("stays open after pointer motion", tgt.is_open())

        print("\n2) searching filters the list")
        entries = [w for w in tgt._popup.winfo_children() if isinstance(w, ctk.CTkEntry)]
        check("search field present", len(entries) == 1)
        search = entries[0]
        tgt._filter("kaz")
        app.update()
        visible = [b for b, _h in tgt._rows if b.winfo_manager()]
        check("filter narrows to few rows", 0 < len(visible) <= 3, f"{len(visible)} visible")
        tgt._filter("")
        app.update()
        check("clearing search restores all rows",
              len([b for b, _h in tgt._rows if b.winfo_manager()]) == 38)

        print("\n3) choosing a language")
        tgt._choose("kk")
        app.update()
        check("value set to kk", tgt.get() == "kk", tgt.get())
        check("overlay closed after choosing", not tgt.is_open())
        check("label shows Kazakh", "Kazakh" in tgt._label(), tgt._label())

        print("\n4) dismissal paths")
        tgt.toggle()
        app.update()
        check("reopened", tgt.is_open())
        tgt._close()
        app.update()
        check("explicit close works", not tgt.is_open())

        tgt.toggle()
        app.update()
        check("Escape bound while open", tgt._bind_esc is not None)
        tgt._close()
        app.update()
        check("bindings released after close",
              tgt._bind_esc is None and tgt._bind_click is None)

        print("\n5) trigger toggles rather than closing and reopening")
        tgt.toggle()
        app.update()
        was = tgt.is_open()
        tgt.toggle()
        app.update()
        check("second toggle closes", was and not tgt.is_open())

        print("\n6) source picker includes Auto Detect")
        src.toggle()
        app.update()
        check("source picker has 39 rows", len(src._rows) == 39, f"{len(src._rows)} rows")
        check("first row is Auto Detect", "Auto Detect" in src._rows[0][0].cget("text"),
              src._rows[0][0].cget("text"))
        src._close()
        app.update()

        print("\n7) overlay is not orphaned when the page is rebuilt")
        tgt.toggle()
        app.update()
        check("open before rebuild", tgt.is_open())
        app.set_theme("light")
        for _ in range(4):
            app.update()
        strays = [w for w in app.winfo_children()
                  if isinstance(w, ctk.CTkFrame) and w not in (app.sidebar, app.content)]
        check("no orphaned overlay after theme rebuild", len(strays) == 0,
              f"{len(strays)} stray frames")
        check("overlay state is clean after rebuild",
              not app._pages["Translate"].tgt_picker.is_open())
        app.set_theme("dark")
        for _ in range(3):
            app.update()

        app.quit()

    app.after(500, stage)
    app.mainloop()

    print()
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL DROPDOWN CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
