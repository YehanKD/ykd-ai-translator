"""The Settings screen — General, Appearance and About (Figma node 9:147)."""

from __future__ import annotations

import sys
from pathlib import Path

import customtkinter as ctk

from .. import APP_VERSION

STARTUP_DIR = Path.home() / ".config" / "autostart"
STARTUP_FILE = STARTUP_DIR / "ykd-ai-translator.desktop"


class SettingsPage(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color=app.T["sidebar"], corner_radius=0)
        self.app = app
        self.T = app.T

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(self, text="Settings", font=("", 20, "bold"),
                     text_color=self.T["text"]).grid(
            row=0, column=0, sticky="w", padx=28, pady=(20, 12))

        body = ctk.CTkScrollableFrame(self, fg_color="transparent")
        body.grid(row=1, column=0, sticky="nsew", padx=22, pady=(0, 20))

        self._section(body, "General")
        self.cb_clipboard = self._toggle(
            body, "Auto-translate clipboard",
            "Automatically translate copied text when the window gains focus",
            "auto_clipboard", self._toggle_clipboard)
        self.cb_ontop = self._toggle(
            body, "Always on top",
            "Keep the translator window floating above other applications",
            "always_on_top", self._toggle_ontop)
        self.cb_startup = self._toggle(
            body, "Launch at startup",
            "Start YKD AI automatically when you log in",
            "launch_at_startup", self._toggle_startup)

        self._section(body, "Appearance")
        self._label_pair(body, "Application Theme", "Choose your interface appearance preference")
        self.theme_var = ctk.StringVar(value=self.app.cfg.get("theme", "dark").capitalize())
        ctk.CTkSegmentedButton(
            body, values=["System", "Light", "Dark"], variable=self.theme_var,
            fg_color=self.T["card2"], selected_color=self.T["accent"],
            selected_hover_color=self.T["accent2"], unselected_color=self.T["card2"],
            text_color=self.T["text"], font=("", 12),
            command=self._set_theme,
        ).pack(anchor="w", padx=6, pady=(4, 14))

        self._section(body, "About")
        for text, colour in [
            ("YKD AI Desktop Client", self.T["text"]),
            (f"v{APP_VERSION}", self.T["muted"]),
            ("Local Model Runtime (Zero telemetry enabled)", self.T["muted"]),
            ("Hunyuan-MT-7B · 38 languages · fully offline", self.T["faint"]),
        ]:
            ctk.CTkLabel(body, text=text, font=("", 12), text_color=colour,
                         anchor="w").pack(fill="x", padx=6, pady=1)

    # ------------------------------------------------------------- helpers
    def _section(self, parent, title: str):
        ctk.CTkLabel(parent, text=title, font=("", 13, "bold"),
                     text_color=self.T["accent"], anchor="w").pack(
            fill="x", padx=6, pady=(14, 4))

    def _label_pair(self, parent, title: str, subtitle: str):
        ctk.CTkLabel(parent, text=title, font=("", 12), text_color=self.T["text"],
                     anchor="w").pack(fill="x", padx=6, pady=(4, 0))
        ctk.CTkLabel(parent, text=subtitle, font=("", 11), text_color=self.T["faint"],
                     anchor="w").pack(fill="x", padx=6)

    def _toggle(self, parent, title: str, subtitle: str, key: str, command):
        row = ctk.CTkFrame(parent, fg_color="transparent")
        row.pack(fill="x", padx=6, pady=4)
        row.grid_columnconfigure(0, weight=1)

        text = ctk.CTkFrame(row, fg_color="transparent")
        text.grid(row=0, column=0, sticky="w")
        ctk.CTkLabel(text, text=title, font=("", 12), text_color=self.T["text"],
                     anchor="w").pack(fill="x")
        ctk.CTkLabel(text, text=subtitle, font=("", 11), text_color=self.T["faint"],
                     anchor="w").pack(fill="x")

        var = ctk.BooleanVar(value=bool(self.app.cfg.get(key, False)))
        ctk.CTkSwitch(
            row, text="", variable=var, width=44,
            fg_color=self.T["line2"], progress_color=self.T["accent"],
            command=lambda k=key, v=var: command(k, v),
        ).grid(row=0, column=1, sticky="e")
        return var

    # ------------------------------------------------------------- actions
    def _toggle_clipboard(self, key: str, var):
        self.app.cfg[key] = bool(var.get())
        self.app.persist()
        self.app.set_clipboard_watch(bool(var.get()))

    def _toggle_ontop(self, key: str, var):
        value = bool(var.get())
        self.app.cfg[key] = value
        self.app.persist()
        self.app.attributes("-topmost", value)

    def _toggle_startup(self, key: str, var):
        """Create or remove an XDG autostart entry (Linux only)."""
        value = bool(var.get())
        self.app.cfg[key] = value
        self.app.persist()
        if sys.platform == "win32":
            return  # Windows startup is handled by the installer
        try:
            if value:
                STARTUP_DIR.mkdir(parents=True, exist_ok=True)
                STARTUP_FILE.write_text(
                    "[Desktop Entry]\n"
                    "Type=Application\n"
                    "Name=YKD AI Translator\n"
                    f"Exec={self.app.launch_command()}\n"
                    "Terminal=false\n",
                    encoding="utf-8",
                )
            elif STARTUP_FILE.exists():
                STARTUP_FILE.unlink()
        except OSError:
            pass

    def _set_theme(self, choice: str):
        self.app.set_theme(choice.lower())
        # The switch is deferred by a tick; reflect the pending value so the
        # segmented button never snaps back before the rebuild lands.
        self.app.cfg["theme"] = choice.lower()

    def refresh_theme(self, theme: dict):
        self.T = theme
        self.configure(fg_color=self.T["sidebar"])
