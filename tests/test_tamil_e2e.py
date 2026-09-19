"""End-to-end: Tamil source, English chosen -> must produce ENGLISH output.

This is the exact reported bug, verified through the real engine rather than
by inspecting state.
"""

import os
import sys
import tempfile
import time
from pathlib import Path

os.environ["YKD_CONFIG_DIR"] = tempfile.mkdtemp(prefix="ykd-e2e-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd.app import App
from ykd.engine import STATE_FAILED, STATE_READY

TAMIL = "இன்று காலை நான் நண்பர்களுடன் பூங்காவிற்குச் சென்றேன்."


def has_tamil(s):
    return any(0x0B80 <= ord(c) <= 0x0BFF for c in s)


def has_han(s):
    return any(0x4E00 <= ord(c) <= 0x9FFF for c in s)


def main():
    app = App()
    app.geometry("1100x720+60+40")
    app.update()
    result = {}

    def stage():
        app.engine.start()
        app.after(600, wait_ready)

    def wait_ready():
        if app.engine.state not in (STATE_READY, STATE_FAILED):
            app.after(500, wait_ready)
            return
        if app.engine.state != STATE_READY:
            print("engine failed:", app.engine.last_error)
            app.quit()
            return
        page = app._pages["Translate"]
        page.source.insert("1.0", TAMIL)
        page._on_source_changed()
        app.update()
        print("auto default target:", page.tgt_picker.get())
        # user picks English
        page.tgt_picker.set("en", notify=True)
        app.update()
        print("after choosing English:", page._effective_target())
        page.translate()
        app.after(500, wait_done)

    def wait_done():
        page = app._pages["Translate"]
        if page.busy:
            app.after(500, wait_done)
            return
        out = page.output.get("1.0", "end").strip()
        print("\nOUTPUT:", out)
        result["out"] = out
        ok_en = bool(out) and not has_tamil(out) and not has_han(out)
        print()
        print(f"  [{'PASS' if ok_en else 'FAIL'}] output is English "
              f"(no Tamil, no Chinese)")
        if not ok_en:
            print(f"         tamil={has_tamil(out)} han={has_han(out)}")
        app.engine.stop()
        app.quit()

    app.after(300, stage)
    app.mainloop()

    out = result.get("out", "")
    return 0 if (out and not has_tamil(out) and not has_han(out)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
