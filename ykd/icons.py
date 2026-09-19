"""Icon and flag images.

Two reasons these are rendered/downloaded rather than typed as characters:

* **Flags:** Tk picks a font per character, and on a typical Linux box that is
  Liberation Sans, which has no regional-indicator glyphs — so ``🇨🇳`` silently
  renders as the literal letters "CN". Real flag images avoid that entirely.
* **Nav icons:** the design uses specific vector glyphs (a translate mark, a
  clock-with-arrow, a cog). Unicode lookalikes do not match, so they are drawn
  here with Pillow at 4x and downsampled for smooth edges.
"""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent / "assets"
FLAGS_DIR = ASSETS / "flags"

# Supersample factor for the drawn icons.
_SS = 4


def _assets_root() -> Path:
    """Assets directory, correct both frozen and running from source."""
    import sys

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass) / "ykd" / "assets"
    return ASSETS


def _flags_dir() -> Path:
    return _assets_root() / "flags"


# --------------------------------------------------------------------- flags
@lru_cache(maxsize=128)
def flag_path(code: str) -> Path | None:
    """Path to the flag PNG for a language code, or None."""
    p = _flags_dir() / f"{code}.png"
    return p if p.exists() else None


def flag_image(code: str, height: int = 14):
    """A CTkImage for the language's flag, or None if unavailable."""
    import customtkinter as ctk

    p = flag_path(code)
    if p is None:
        return None
    try:
        im = Image.open(p).convert("RGBA")
    except OSError:
        return None
    ratio = im.width / im.height
    width = max(1, round(height * ratio))
    im = im.resize((width * 2, height * 2), Image.LANCZOS)  # 2x for hidpi
    return ctk.CTkImage(light_image=im, dark_image=im, size=(width, height))


# --------------------------------------------------------------------- icons
def _new(size: int) -> Image.Image:
    return Image.new("RGBA", (size * _SS, size * _SS), (0, 0, 0, 0))


def _finish(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.LANCZOS)


def _draw_translate(d: ImageDraw.ImageDraw, s: int, col: tuple) -> None:
    """Translate mark: a CJK-style glyph top-left, a slanted 'A' bottom-right."""
    w = max(2, round(s * 0.09))
    # top-left block: two stacked strokes + a crossbar (reads as a hanzi)
    d.line([(s * 0.10, s * 0.26), (s * 0.58, s * 0.26)], fill=col, width=w)
    d.line([(s * 0.34, s * 0.12), (s * 0.34, s * 0.44)], fill=col, width=w)
    d.line([(s * 0.16, s * 0.42), (s * 0.52, s * 0.42)], fill=col, width=w)
    # bottom-right: an 'A'
    d.line([(s * 0.56, s * 0.88), (s * 0.74, s * 0.56)], fill=col, width=w)
    d.line([(s * 0.74, s * 0.56), (s * 0.92, s * 0.88)], fill=col, width=w)
    d.line([(s * 0.63, s * 0.76), (s * 0.85, s * 0.76)], fill=col, width=w)


def _draw_history(d: ImageDraw.ImageDraw, s: int, col: tuple) -> None:
    """Clock face inside a circular arrow (history / going back in time)."""
    w = max(2, round(s * 0.09))
    r = s * 0.36
    cx = cy = s * 0.52
    # open circle, leaving a gap at the top-left for the arrow head
    d.arc([cx - r, cy - r, cx + r, cy + r], start=300, end=250, fill=col, width=w)
    # arrow head at the start of the arc
    a = math.radians(300)
    tipx, tipy = cx + r * math.cos(a), cy + r * math.sin(a)
    h = s * 0.16
    d.polygon(
        [
            (tipx - h * 0.5, tipy - h * 0.35),
            (tipx + h * 0.5, tipy - h * 0.35),
            (tipx, tipy + h * 0.75),
        ],
        fill=col,
    )
    # clock hands
    d.line([(cx, cy), (cx, cy - r * 0.55)], fill=col, width=w)
    d.line([(cx, cy), (cx + r * 0.42, cy)], fill=col, width=w)


def _draw_settings(d: ImageDraw.ImageDraw, s: int, col: tuple) -> None:
    """A cog with eight teeth and a hollow centre."""
    cx = cy = s / 2
    outer = s * 0.46
    inner = s * 0.30
    tooth = s * 0.13
    # ring
    d.ellipse(
        [cx - inner, cy - inner, cx + inner, cy + inner],
        outline=col, width=max(2, round(s * 0.10)),
    )
    # teeth
    for i in range(8):
        a = math.radians(i * 45)
        d.line(
            [
                (cx + inner * math.cos(a) * 0.95, cy + inner * math.sin(a) * 0.95),
                (cx + outer * math.cos(a), cy + outer * math.sin(a)),
            ],
            fill=col,
            width=max(2, round(tooth)),
        )


def _draw_chevron_left(d: ImageDraw.ImageDraw, s: int, col: tuple) -> None:
    """A '<' chevron: collapse the sidebar."""
    w = max(2, round(s * 0.11))
    d.line([(s * 0.62, s * 0.22), (s * 0.36, s * 0.50)], fill=col, width=w)
    d.line([(s * 0.36, s * 0.50), (s * 0.62, s * 0.78)], fill=col, width=w)


def _draw_chevron_right(d: ImageDraw.ImageDraw, s: int, col: tuple) -> None:
    """A '>' chevron: expand the sidebar."""
    w = max(2, round(s * 0.11))
    d.line([(s * 0.38, s * 0.22), (s * 0.64, s * 0.50)], fill=col, width=w)
    d.line([(s * 0.64, s * 0.50), (s * 0.38, s * 0.78)], fill=col, width=w)


_DRAWERS = {
    "translate": _draw_translate,
    "history": _draw_history,
    "settings": _draw_settings,
    "chevron-left": _draw_chevron_left,
    "chevron-right": _draw_chevron_right,
}


@lru_cache(maxsize=64)
def icon_png(name: str, size: int, hex_colour: str) -> Image.Image:
    """Render an icon to a Pillow image (cached)."""
    col = _hex_to_rgba(hex_colour)
    im = _new(size)
    d = ImageDraw.Draw(im)
    _DRAWERS[name](d, size * _SS, col)
    return _finish(im, size)


def _hex_to_rgba(value: str) -> tuple[int, int, int, int]:
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16), 255)


def icon_image(name: str, size: int = 16, colour: str = "#cacacd"):
    """A CTkImage for a named icon, or None if the name is unknown."""
    import customtkinter as ctk

    if name not in _DRAWERS:
        return None
    im = icon_png(name, size * 2, colour)  # 2x for hidpi
    return ctk.CTkImage(light_image=im, dark_image=im, size=(size, size))


def icon_photo(name: str, size: int = 16, colour: str = "#cacacd"):
    """A tkinter PhotoImage for a named icon (for plain tk widgets)."""
    import tkinter as tk

    from PIL import ImageTk

    return ImageTk.PhotoImage(icon_png(name, size, colour))
