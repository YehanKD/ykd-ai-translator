"""Capture a README screenshot of the app in a normal, populated state.

Run: build-venv/bin/python tools/make_screenshot.py
Writes docs/screenshot.png
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

os.environ["YKD_CONFIG_DIR"] = tempfile.mkdtemp(prefix="ykd-shot-")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ykd.app import App  # noqa: E402

OUT = ROOT / "docs" / "screenshot.png"


def rect(pid):
    raw = subprocess.run(["hyprctl", "clients", "-j"],
                         capture_output=True, text=True).stdout
    for c in json.loads(raw):
        if c.get("pid") == pid:
            x, y = c["at"]
            w, h = c["size"]
            return f"{x},{y} {w}x{h}"
    return None


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    app = App()
    app.geometry("1100x720+80+60")
    app.update()

    def stage():
        page = app._pages["Translate"]
        page.source.insert(
            "1.0",
            "在个人资料里面把这个开起来，就算密码泄露，别人也登录不上你的账号。",
        )
        page._on_source_changed()
        page.output.configure(state="normal")
        page.output.insert(
            "1.0",
            "Turn this on in your profile. Even if your password is leaked,\n"
            "others won't be able to log in to your account.",
        )
        page.output.configure(state="disabled")
        app.update()
        time.sleep(0.8)

        r = rect(os.getpid())
        if r is None:
            print("could not locate the window; skipping screenshot")
        else:
            subprocess.run(["grim", "-g", r, str(OUT)], check=False)
            print("wrote", OUT, r)
        app.quit()

    app.after(700, stage)
    app.mainloop()


if __name__ == "__main__":
    main()
