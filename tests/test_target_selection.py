"""Regression tests for the target-language selection.

The reported bug: with the source on Auto Detect and Tamil pasted in, picking
**English** from the target dropdown still translated to Chinese.

Cause: ``_effective_target()`` ignored the picker when the source was Auto and
recomputed the target from the detected language, so the user's choice was
discarded. Auto-detection must only set a *default*, never override a choice.
"""

import os
import sys
import tempfile
from pathlib import Path

os.environ["YKD_CONFIG_DIR"] = tempfile.mkdtemp(prefix="ykd-tgt-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd.app import App  # noqa: E402

TAMIL = ("இன்று காலை நான் நண்பர்களுடன் பூங்காவிற்குச் சென்றேன். "
         "அங்கு நாங்கள் சிறிது நேரம் பேசினோம்.")
CHINESE = "在个人资料里面 把这个开起来"
ENGLISH = "The package arrived damaged, so I need a refund."

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
        page = app._pages["Translate"]

        print("\n1) the reported bug: Tamil in, English chosen")
        page.source.delete("1.0", "end")
        page.source.insert("1.0", TAMIL)
        page._on_source_changed()
        app.update()
        check("auto default for Tamil is Chinese",
              page.tgt_picker.get() == "zh", page.tgt_picker.get())

        # user picks English from the dropdown
        page.tgt_picker.set("en", notify=True)
        app.update()
        check("picker shows English", page.tgt_picker.get() == "en")
        check("effective target is ENGLISH (was zh before the fix)",
              page._effective_target() == "en", page._effective_target())

        # typing more must NOT drag it back to Chinese
        page.source.insert("end", " மேலும் சில வார்த்தைகள்.")
        page._on_source_changed()
        app.update()
        check("stays English after further typing",
              page._effective_target() == "en", page._effective_target())
        check("picker still shows English", page.tgt_picker.get() == "en")

        print("\n2) the default still works before any manual choice")
        page._target_user_set = False
        page.source.delete("1.0", "end")
        page.source.insert("1.0", CHINESE)
        page._on_source_changed()
        app.update()
        check("chinese input -> default English",
              page.tgt_picker.get() == "en", page.tgt_picker.get())
        page.source.delete("1.0", "end")
        page.source.insert("1.0", ENGLISH)
        page._on_source_changed()
        app.update()
        check("english input -> default Chinese",
              page.tgt_picker.get() == "zh", page.tgt_picker.get())

        print("\n3) explicit choice survives a language switch and restart")
        page.tgt_picker.set("fr", notify=True)
        app.update()
        check("target_lang_explicit recorded in config",
              app.cfg.get("target_lang_explicit") is True)
        check("target_lang saved", app.cfg.get("target_lang") == "fr",
              str(app.cfg.get("target_lang")))

        # a fresh page (as after a theme rebuild) must honour the saved choice
        app.set_theme("light")
        for _ in range(4):
            app.update()
        fresh = app._pages["Translate"]
        check("rebuilt page restores explicit flag",
              fresh._target_user_set is True)
        fresh.source.insert("1.0", TAMIL)
        fresh._on_source_changed()
        app.update()
        check("rebuilt page keeps user's target, not the auto default",
              fresh._effective_target() == "fr", fresh._effective_target())
        app.set_theme("dark")
        for _ in range(3):
            app.update()

        print("\n4) changing the SOURCE language re-arms the default")
        page2 = app._pages["Translate"]
        page2.src_picker.set("ta", notify=True)   # pick Tamil as source
        app.update()
        check("target follows source default (ta -> zh)",
              page2.tgt_picker.get() == "zh", page2.tgt_picker.get())
        check("explicit flag cleared for the new pair",
              page2._target_user_set is False)
        page2.src_picker.set("auto", notify=True)
        app.update()

        print("\n5) choosing Auto Detect as target is honoured too")
        page2.tgt_picker.set("en", notify=True)
        app.update()
        check("explicit en sticks", page2._effective_target() == "en")

        app.quit()

    app.after(500, stage)
    app.mainloop()

    print()
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL TARGET-SELECTION CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
