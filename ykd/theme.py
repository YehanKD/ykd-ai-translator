"""Dark and light palettes, sampled from the Figma design.

Values were taken directly from the rendered Figma frames (node 9:16 dark,
9:221 light) because the file defines no design variables. The accent is
teal-600 (``#0d9488``) in both themes.
"""

from __future__ import annotations

DARK = {
    "canvas": "#0c0c0e",          # outer chrome / header
    "sidebar": "#141416",         # sidebar and main surface
    "card": "#141416",            # panels share the main surface
    "card2": "#1f1f21",           # raised rows and cards
    "inset": "#131315",           # inputs, dropdown menu
    "line": "#262628",            # borders
    "line2": "#2e2e30",           # stronger borders
    "text": "#cacacd",
    "muted": "#7c7c7e",
    "faint": "#48484a",
    "accent": "#0d9488",
    "accent2": "#0f766e",         # hover
    "on_accent": "#ffffff",
    "nav_active_bg": "#132727",
    "ok": "#0d9488",
    "err": "#f87171",
}

LIGHT = {
    "canvas": "#ffffff",
    "sidebar": "#ffffff",
    "card": "#ffffff",
    "card2": "#f0f0f0",
    "inset": "#fafafa",
    "line": "#ebebeb",
    "line2": "#c5c5c6",
    "text": "#343438",
    "muted": "#515154",
    "faint": "#8b8b8d",
    "accent": "#0d9488",
    "accent2": "#0f766e",
    "on_accent": "#ffffff",
    "nav_active_bg": "#e6f4f3",
    "ok": "#0d9488",
    "err": "#dc2626",
}


def palette(mode: str) -> dict:
    """Return the palette for ``"dark"`` or ``"light"`` (anything else = dark)."""
    return LIGHT if mode == "light" else DARK
