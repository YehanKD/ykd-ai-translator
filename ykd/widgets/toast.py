"""A small transient notification bar.

Replaces the old pattern of overwriting a status label with the error text,
which lost the previous state and could not be dismissed.
"""

from __future__ import annotations

import customtkinter as ctk


class Toast(ctk.CTkFrame):
    """Slide-free toast pinned to the bottom of its parent.

    ``show(message, kind)`` where kind is ``"info"``, ``"ok"`` or ``"err"``.
    Auto-hides after ``duration_ms``.
    """

    def __init__(self, master, theme: dict, duration_ms: int = 4000):
        super().__init__(master, fg_color="transparent")
        self.T = theme
        self._duration = duration_ms
        self._after_id: str | None = None

        self.label = ctk.CTkLabel(
            self,
            text="",
            height=34,
            corner_radius=8,
            fg_color=self.T["card2"],
            text_color=self.T["text"],
            font=("", 12),
        )
        self.label.pack(fill="x")
        self._visible = False

    def refresh_theme(self, theme: dict) -> None:
        self.T = theme
        self.label.configure(fg_color=self.T["card2"], text_color=self.T["text"])

    def show(self, message: str, kind: str = "info") -> None:
        colour = {
            "info": self.T["muted"],
            "ok": self.T["accent"],
            "err": self.T["err"],
        }.get(kind, self.T["muted"])

        self.label.configure(text=message, text_color=colour)
        self.label.pack(fill="x")

        if self._after_id is not None:
            try:
                self.after_cancel(self._after_id)
            except ValueError:
                pass
        self._after_id = self.after(self._duration, self.hide)

    def hide(self) -> None:
        self._after_id = None
        self.label.pack_forget()
