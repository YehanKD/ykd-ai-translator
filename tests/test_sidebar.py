"""Regression tests for the collapsible sidebar and the removed OFFLINE badge.

Requirements:
  * the sidebar starts COLLAPSED on every launch (not remembered)
  * the collapse toggle switches between the 52px rail and the 180px sidebar
  * collapsed = icon-only nav, no wordmark, no status text
  * expanded = labels, wordmark and status text back
  * the OFFLINE MODE badge is gone from the Translate page
  * a theme switch preserves the current sidebar state
"""

import os
import sys
import tempfile
from pathlib import Path

os.environ["YKD_CONFIG_DIR"] = tempfile.mkdtemp(prefix="ykd-side-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd.app import NAV_ITEMS, SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH, App  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def find_label_texts(widget, found=None):
    """Collect every CTkLabel's text under a widget."""
    import customtkinter as ctk
    if found is None:
        found = []
    for child in widget.winfo_children():
        if isinstance(child, ctk.CTkLabel):
            try:
                found.append(child.cget("text"))
            except Exception:                               # noqa: BLE001
                pass
        find_label_texts(child, found)
    return found


def main():
    app = App()
    app.report_callback_exception = lambda *a: failures.append(f"tk: {a[1]}")
    app.geometry("1100x720+60+40")
    app.update()

    def stage():
        print("\n1) starts collapsed")
        check("_collapsed is True at startup", app._collapsed is True)
        check("sidebar width is the rail", app.sidebar.cget("width") == SIDEBAR_RAIL_WIDTH,
              str(app.sidebar.cget("width")))
        # cget() only reports the requested value; assert the RENDERED width,
        # which is what actually shrank the layout.
        app.update_idletasks()
        check("sidebar RENDERS at the rail width",
              app.sidebar.winfo_width() == SIDEBAR_RAIL_WIDTH,
              f"rendered={app.sidebar.winfo_width()} expected={SIDEBAR_RAIL_WIDTH}")
        check("content starts right after the rail",
              app.content.winfo_x() == SIDEBAR_RAIL_WIDTH,
              str(app.content.winfo_x()))
        check("wordmark hidden", not app.brand_text.winfo_manager())
        check("status text hidden", not app.status_text.winfo_manager())
        for name, _ in NAV_ITEMS:
            btn = app._nav_buttons[name]
            check(f"nav '{name}' is icon-only", btn.cget("text") == "",
                  repr(btn.cget("text")))
            check(f"nav '{name}' has an icon", btn.cget("image") not in ("", None))

        print("\n2) toggle expands")
        app.toggle_sidebar()
        app.update_idletasks()
        check("_collapsed now False", app._collapsed is False)
        check("sidebar RENDERS at full width",
              app.sidebar.winfo_width() == SIDEBAR_WIDTH,
              f"rendered={app.sidebar.winfo_width()} expected={SIDEBAR_WIDTH}")
        check("content moved right", app.content.winfo_x() == SIDEBAR_WIDTH,
              str(app.content.winfo_x()))
        check("wordmark shown", bool(app.brand_text.winfo_manager()))
        check("status text shown", bool(app.status_text.winfo_manager()))
        for name, _ in NAV_ITEMS:
            btn = app._nav_buttons[name]
            check(f"nav '{name}' shows label", name in btn.cget("text"),
                  repr(btn.cget("text")))

        print("\n3) toggle collapses again")
        app.toggle_sidebar()
        app.update_idletasks()
        check("back to collapsed", app._collapsed is True)
        check("rail width rendered again",
              app.sidebar.winfo_width() == SIDEBAR_RAIL_WIDTH,
              str(app.sidebar.winfo_width()))

        print("\n4) chevron reflects the action")
        right = app._collapse_icon
        check("collapsed -> chevron-right", right is not None)
        app.toggle_sidebar()
        app.update()
        left = app._collapse_icon
        check("expanded -> chevron-left", left is not None and left is not right)

        print("\n5) OFFLINE MODE badge removed")
        page = app._pages["Translate"]
        texts = find_label_texts(page)
        check("no 'OFFLINE MODE' label on Translate page",
              not any("OFFLINE" in str(t).upper() for t in texts),
              str([t for t in texts if "OFFLINE" in str(t).upper()]))
        check("page title still present", any("Translation" in str(t) for t in texts))

        print("\n6) theme switch preserves sidebar state")
        app.toggle_sidebar()          # collapse
        app.update()
        check("collapsed before switch", app._collapsed is True)
        app.set_theme("light")
        for _ in range(4):
            app.update()
        check("still collapsed after theme switch", app._collapsed is True)
        check("still rail width after theme switch",
              app.sidebar.cget("width") == SIDEBAR_RAIL_WIDTH,
              str(app.sidebar.cget("width")))
        check("wordmark still hidden", not app.brand_text.winfo_manager())
        app.set_theme("dark")
        for _ in range(3):
            app.update()

        print("\n7) navigation still works while collapsed")
        app.show("History")
        app.update()
        check("History raised", app._pages["History"].winfo_ismapped() == 1
              or app._active == "History", app._active)
        app.show("Translate")
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
    print("ALL SIDEBAR CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
