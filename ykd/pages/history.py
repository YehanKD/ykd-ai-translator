"""The History screen — searchable list of past translations (Figma node 9:66)."""

from __future__ import annotations

from datetime import datetime

import customtkinter as ctk


def _ago(iso: str) -> str:
    """Human-readable relative time for an ISO timestamp."""
    try:
        delta = (datetime.now() - datetime.fromisoformat(iso)).total_seconds()
    except (TypeError, ValueError):
        return ""
    if delta < 60:
        return "just now"
    if delta < 3600:
        return f"{int(delta // 60)}m ago"
    if delta < 86400:
        return f"{int(delta // 3600)}h ago"
    if delta < 172800:
        return "Yesterday"
    return f"{int(delta // 86400)} days ago"


class HistoryPage(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color=app.T["sidebar"], corner_radius=0)
        self.app = app
        self.T = app.T

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=0, column=0, sticky="ew", padx=28, pady=(20, 12))
        bar.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(bar, text="History", font=("", 20, "bold"),
                     text_color=self.T["text"]).grid(row=0, column=0, sticky="w")
        ctk.CTkButton(bar, text="Clear All", width=80, height=30, corner_radius=8,
                      fg_color="transparent", hover_color=self.T["card2"],
                      text_color=self.T["muted"], font=("", 12),
                      command=self._clear_all).grid(row=0, column=1, sticky="e")

        self.search = ctk.CTkEntry(
            self, placeholder_text="Search past translations...", height=36,
            fg_color=self.T["inset"], border_color=self.T["line"],
            text_color=self.T["text"], font=("", 13),
        )
        self.search.grid(row=1, column=0, sticky="ew", padx=28, pady=(0, 10))
        self.search.bind("<KeyRelease>", lambda _e: self.render())

        self.list = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.list.grid(row=2, column=0, sticky="nsew", padx=22, pady=(0, 20))

    def render(self):
        for child in self.list.winfo_children():
            child.destroy()

        query = self.search.get().strip().lower()
        entries = list(self.app.cfg.get("history", []))

        if query:
            entries = [
                e for e in entries
                if query in str(e.get("source", "")).lower()
                or query in str(e.get("translated", "")).lower()
            ]

        if not entries:
            ctk.CTkLabel(
                self.list,
                text="No translations yet" if not query else "No matches",
                font=("", 13), text_color=self.T["faint"],
            ).pack(pady=40)
            return

        for entry in entries:
            card = ctk.CTkFrame(self.list, fg_color=self.T["card2"],
                                corner_radius=10, border_width=1,
                                border_color=self.T["line"])
            card.pack(fill="x", pady=4, padx=6)
            card.grid_columnconfigure(0, weight=1)

            head = ctk.CTkFrame(card, fg_color="transparent")
            head.grid(row=0, column=0, sticky="ew", padx=14, pady=(10, 2))
            head.grid_columnconfigure(0, weight=1)

            ctk.CTkLabel(
                head, text=str(entry.get("direction", "")).upper(),
                font=("", 10, "bold"), text_color=self.T["accent"],
            ).grid(row=0, column=0, sticky="w")
            ctk.CTkLabel(
                head, text=_ago(str(entry.get("time", ""))),
                font=("", 10), text_color=self.T["faint"],
            ).grid(row=0, column=1, sticky="e")

            ctk.CTkLabel(
                card, text=str(entry.get("source", "")),
                font=("", 12), text_color=self.T["muted"],
                wraplength=760, justify="left", anchor="w",
            ).grid(row=1, column=0, sticky="ew", padx=14)

            ctk.CTkLabel(
                card, text=str(entry.get("translated", "")),
                font=("", 12), text_color=self.T["text"],
                wraplength=760, justify="left", anchor="w",
            ).grid(row=2, column=0, sticky="ew", padx=14, pady=(2, 10))

    def _clear_all(self):
        self.app.cfg["history"] = []
        self.app.persist()
        self.render()

    def refresh_theme(self, theme: dict):
        self.T = theme
        self.configure(fg_color=self.T["sidebar"])
        self.search.configure(fg_color=self.T["inset"], border_color=self.T["line"],
                              text_color=self.T["text"])
        self.render()
