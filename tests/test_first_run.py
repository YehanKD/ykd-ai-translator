"""Verify the first-run model setup overlay appears when no model is present."""

import os
import sys
import tempfile
from pathlib import Path

# Empty data dir AND an empty "bundle" so no model can be found.
os.environ["YKD_DATA_DIR"] = tempfile.mkdtemp(prefix="ykd-first-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd import model_store  # noqa: E402

empty = Path(tempfile.mkdtemp(prefix="ykd-nomodel-"))
model_store.bundle_root = lambda: empty

from ykd.app import App  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def main():
    app = App()
    app.report_callback_exception = lambda *a: failures.append(f"tk: {a[1]}")
    app.geometry("1100x720+60+40")
    app.update()

    def stage():
        print("\n1) overlay shown instead of starting the engine")
        overlay = getattr(app, "_model_overlay", None)
        check("overlay created", overlay is not None)
        check("engine NOT started (no model to load)",
              app.engine.state == "idle", app.engine.state)
        check("overlay is mapped", overlay.winfo_ismapped() == 1 if overlay else False)

        if overlay:
            texts = []

            def collect(w):
                import customtkinter as ctk
                for c in w.winfo_children():
                    if isinstance(c, ctk.CTkLabel):
                        texts.append(str(c.cget("text")))
                    collect(c)

            collect(overlay)
            joined = " ".join(texts)
            check("mentions the model download", "download" in joined.lower(), joined[:90])
            check("states the size", "4.3" in joined, joined[:120])
            check("names the licence", "Tencent" in joined)
            check("has a Download button",
                  overlay.primary.cget("text").startswith("Download"),
                  overlay.primary.cget("text"))
            check("has a Quit button", "Quit" in overlay.secondary.cget("text"))
            check("progress bar hidden before starting",
                  not overlay.progress.winfo_manager())

        print("\n2) cancel path is safe")
        if overlay:
            overlay.start_download()
            app.update()
            check("download started", overlay._downloading is True)
            check("button disabled while downloading",
                  overlay.primary.cget("state") == "disabled",
                  overlay.primary.cget("state"))
            check("secondary became Cancel", "Cancel" in overlay.secondary.cget("text"))
            overlay.cancel_download()
            app.update()
            check("cancelled cleanly", overlay._downloading is False)
            check("button re-enabled", overlay.primary.cget("state") == "normal")
            check("back to Quit", "Quit" in overlay.secondary.cget("text"))

        app.quit()

    app.after(700, stage)
    app.mainloop()

    print()
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL FIRST-RUN CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
