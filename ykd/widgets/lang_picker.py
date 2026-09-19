"""Searchable language dropdown matching the Figma design.

The open list is drawn as an **overlay inside the main window**, not as a
separate ``Toplevel``. That is deliberate:

* A ``Toplevel`` with ``overrideredirect(True)`` is not managed by the window
  manager. On Wayland, moving the pointer onto it can shift focus away and fire
  ``<FocusOut>``, closing the list the moment the user reaches for it.
* An overlay has no focus semantics of its own, so hovering it, moving the
  mouse across it, or the window manager changing focus cannot dismiss it.

Dismissal is explicit: pick a language, press Escape, or click outside.

Flags are real images rather than emoji: on Linux, Tk falls back to a font with
no regional-indicator glyphs and ``🇨🇳`` renders as the letters "CN".
"""

from __future__ import annotations

import customtkinter as ctk

from ..icons import flag_image, icon_image
from ..languages import LANGS, is_weak, name

AUTO_LABEL = "Auto Detect"
AUTO_CODE = "auto"

POPUP_WIDTH = 290
ROW_HEIGHT = 30
CHROME_HEIGHT = 58          # search field + paddings
MAX_POPUP_HEIGHT = 360


class LanguagePicker(ctk.CTkFrame):
    """A button that opens a searchable language list.

    ``allow_auto`` adds an "Auto Detect" entry at the top (source side only).
    """

    def __init__(self, master, theme: dict, value: str = AUTO_CODE,
                 on_change=None, allow_auto: bool = False, width: int = 200):
        super().__init__(master, fg_color="transparent")
        self.T = theme
        self._value = value
        self._on_change = on_change
        self._allow_auto = allow_auto
        self._popup: ctk.CTkFrame | None = None
        self._rows: list[tuple[ctk.CTkButton, str]] = []
        self._images: list = []          # keeps CTkImage refs alive
        self._flag_ref = None
        self._bind_click = None
        self._bind_esc = None

        self.button = ctk.CTkButton(
            self,
            text=self._label(),
            image=self._flag(),
            compound="left",
            width=width,
            height=36,
            anchor="w",
            corner_radius=8,
            fg_color=self.T["inset"],
            hover_color=self.T["card2"],
            border_width=1,
            border_color=self.T["line"],
            text_color=self.T["text"],
            font=("", 13),
            command=self.toggle,
        )
        self.button.pack(fill="x")

    # ------------------------------------------------------------------ value
    def _flag(self):
        """CTkImage for the current language (kept referenced), or None."""
        self._flag_ref = (
            None if self._value == AUTO_CODE else flag_image(self._value, 14)
        )
        return self._flag_ref

    def _label(self) -> str:
        if self._value == AUTO_CODE:
            return f"{AUTO_LABEL}   ▾"
        suffix = "  •" if is_weak(self._value) else ""
        return f"{name(self._value)}{suffix}   ▾"

    def get(self) -> str:
        return self._value

    def set(self, code: str, notify: bool = False) -> None:
        self._value = code
        self.button.configure(text=self._label(), image=self._flag())
        if notify and self._on_change:
            self._on_change(code)

    def refresh_theme(self, theme: dict) -> None:
        self.T = theme
        self.button.configure(
            fg_color=self.T["inset"],
            hover_color=self.T["card2"],
            border_color=self.T["line"],
            text_color=self.T["text"],
        )

    # ------------------------------------------------------------------ popup
    def toggle(self) -> None:
        """Open the list, or close it if it is already open."""
        if self.is_open():
            self._close()
        else:
            self._open()

    def is_open(self) -> bool:
        return self._popup is not None and self._popup.winfo_exists()

    def _entries(self) -> list[tuple[str, str, str, object]]:
        """(code, label, search haystack, image) for every selectable row."""
        rows: list[tuple[str, str, str, object]] = []
        if self._allow_auto:
            rows.append(
                (AUTO_CODE, AUTO_LABEL, "auto detect",
                 icon_image("translate", 14, self.T["muted"]))
            )
        for code, english, native, _flag, _weak in LANGS:
            rows.append(
                (code, english, f"{english} {native} {code}".lower(),
                 flag_image(code, 14))
            )
        return rows

    def _open(self) -> None:
        if self.is_open():
            return

        top = self.winfo_toplevel()
        entries = self._entries()

        height = min(MAX_POPUP_HEIGHT, CHROME_HEIGHT + ROW_HEIGHT * len(entries))
        pop = ctk.CTkFrame(
            top,
            width=POPUP_WIDTH,
            height=height,
            fg_color=self.T["inset"],
            corner_radius=10,
            border_width=1,
            border_color=self.T["line2"],
        )
        self._popup = pop

        search = ctk.CTkEntry(
            pop,
            placeholder_text="Search languages...",
            height=34,
            fg_color=self.T["card2"],
            border_color=self.T["line"],
            text_color=self.T["text"],
            font=("", 12),
        )
        search.pack(fill="x", padx=8, pady=(8, 4))

        scroller = ctk.CTkScrollableFrame(pop, fg_color="transparent")
        scroller.pack(fill="both", expand=True, padx=4, pady=(0, 8))

        self._rows = []
        self._images = []

        for code, label, haystack, img in entries:
            if img is not None:
                self._images.append(img)
            selected = code == self._value
            btn = ctk.CTkButton(
                scroller,
                text=("✓  " if selected else "     ") + label,
                image=img,
                compound="left",
                anchor="w",
                height=ROW_HEIGHT,
                corner_radius=6,
                fg_color=self.T["nav_active_bg"] if selected else "transparent",
                hover_color=self.T["card2"],
                text_color=self.T["accent"] if selected else self.T["text"],
                font=("", 12),
                command=lambda c=code: self._choose(c),
            )
            btn.pack(fill="x", pady=1)
            self._rows.append((btn, haystack))

        # Position under the trigger, kept inside the window.
        self.update_idletasks()
        x = self.button.winfo_rootx() - top.winfo_rootx()
        y = (self.button.winfo_rooty() - top.winfo_rooty()
             + self.button.winfo_height() + 4)
        max_x = max(8, top.winfo_width() - POPUP_WIDTH - 8)
        x = max(8, min(x, max_x))
        if y + height > top.winfo_height() - 8:
            # Not enough room below -> open upwards instead of off-screen.
            y = max(8, self.button.winfo_rooty() - top.winfo_rooty() - height - 4)
        pop.place(x=x, y=y)
        pop.lift()

        search.bind("<KeyRelease>", lambda _e: self._filter(search.get()))
        self._bind_click = top.bind("<Button-1>", self._on_root_click, add="+")
        self._bind_esc = top.bind("<Escape>", lambda _e: self._close(), add="+")
        search.focus_set()

    def _on_root_click(self, event):
        """Close when the click lands outside the list and off the trigger."""
        if not self.is_open():
            return
        x, y = event.x_root, event.y_root

        # A click on the trigger is handled by the button's own command, which
        # toggles. Without this the press would close and the release reopen.
        if self._inside(self.button, x, y):
            return
        if self._inside(self._popup, x, y):
            return
        self._close()

    @staticmethod
    def _inside(widget, x: int, y: int) -> bool:
        try:
            wx, wy = widget.winfo_rootx(), widget.winfo_rooty()
            ww, wh = widget.winfo_width(), widget.winfo_height()
        except Exception:                                   # noqa: BLE001
            return False
        return wx <= x <= wx + ww and wy <= y <= wy + wh

    def _filter(self, query: str) -> None:
        q = (query or "").strip().lower()
        for btn, haystack in self._rows:
            if (not q) or (q in haystack):
                btn.pack(fill="x", pady=1)
            else:
                btn.pack_forget()

    def _choose(self, code: str) -> None:
        self.set(code, notify=True)
        self._close()

    def _close(self) -> None:
        top = self.winfo_toplevel()
        if self._bind_click is not None:
            try:
                top.unbind("<Button-1>", self._bind_click)
            except Exception:                               # noqa: BLE001
                pass
            self._bind_click = None
        if self._bind_esc is not None:
            try:
                top.unbind("<Escape>", self._bind_esc)
            except Exception:                               # noqa: BLE001
                pass
            self._bind_esc = None

        if self._popup is not None and self._popup.winfo_exists():
            self._popup.destroy()
        self._popup = None
        self._rows = []
        self._images = []

    def destroy(self):
        """Close the overlay too, so a page rebuild cannot orphan it."""
        try:
            self._close()
        except Exception:                                   # noqa: BLE001
            pass
        super().destroy()
