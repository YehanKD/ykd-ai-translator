"""The Translate screen — the app's main workspace.

Layout follows Figma node 9:16: a header with an OFFLINE MODE badge, a source
panel and a target panel side by side with a swap control between them, and a
full-width Translate button below.
"""

from __future__ import annotations

import threading
from datetime import datetime

import customtkinter as ctk

from .. import languages as L
from ..detect import detect
from ..widgets.lang_picker import AUTO_CODE, LanguagePicker
from ..widgets.toast import Toast

CHAR_LIMIT = 5000


class TranslatePage(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color=app.T["sidebar"], corner_radius=0)
        self.app = app
        self.T = app.T
        self.busy = False
        self._placeholder_on = False
        # True once the user picks a target themselves; auto-detect must then
        # stop moving the picker. Restored from config so it survives restarts.
        self._target_user_set = bool(app.cfg.get("target_lang_explicit", False))

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._header()
        self._panels()
        self._button()
        self.toast = Toast(self, self.T)
        self.toast.grid(row=4, column=0, sticky="ew", padx=28, pady=(0, 6))
        self.toast.grid_remove()

    # ---------------------------------------------------------------- header
    def _header(self):
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=0, column=0, sticky="ew", padx=28, pady=(20, 12))
        bar.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(bar, text="Translation", font=("", 20, "bold"),
                     text_color=self.T["text"]).grid(row=0, column=0, sticky="w")

    # ---------------------------------------------------------------- panels
    def _panels(self):
        wrap = ctk.CTkFrame(self, fg_color="transparent")
        wrap.grid(row=1, column=0, sticky="nsew", padx=28)
        wrap.grid_columnconfigure(0, weight=1, uniform="col")
        wrap.grid_columnconfigure(2, weight=1, uniform="col")
        wrap.grid_rowconfigure(0, weight=1)

        # ---- source
        left = ctk.CTkFrame(wrap, fg_color=self.T["card"], corner_radius=12,
                            border_width=1, border_color=self.T["line"])
        left.grid(row=0, column=0, sticky="nsew")
        left.grid_columnconfigure(0, weight=1)
        left.grid_rowconfigure(1, weight=1)

        self.src_picker = LanguagePicker(
            left, self.T, value="auto", allow_auto=True,
            on_change=self._source_lang_changed,
        )
        self.src_picker.grid(row=0, column=0, sticky="w", padx=14, pady=(14, 8))

        self.source = ctk.CTkTextbox(
            left, fg_color=self.T["card"], text_color=self.T["text"],
            border_width=0, wrap="word", font=("", 15),
        )
        self.source.grid(row=1, column=0, sticky="nsew", padx=14, pady=0)
        self.source.bind("<KeyRelease>", self._on_source_changed)
        self.source.bind("<FocusIn>", self._clear_placeholder)

        foot_l = ctk.CTkFrame(left, fg_color="transparent")
        foot_l.grid(row=2, column=0, sticky="ew", padx=14, pady=(4, 12))
        foot_l.grid_columnconfigure(0, weight=1)
        self.counter = ctk.CTkLabel(foot_l, text=f"0 / {CHAR_LIMIT}", font=("", 11),
                                    text_color=self.T["faint"])
        self.counter.grid(row=0, column=0, sticky="w")
        ctk.CTkButton(foot_l, text="Clear", width=60, height=26, corner_radius=6,
                      fg_color="transparent", hover_color=self.T["card2"],
                      text_color=self.T["muted"], font=("", 11),
                      command=self._clear).grid(row=0, column=1, sticky="e")

        # ---- swap
        ctk.CTkButton(
            wrap, text="⇄", width=40, height=40, corner_radius=20,
            fg_color=self.T["card2"], hover_color=self.T["line2"],
            text_color=self.T["text"], font=("", 16), command=self._swap,
        ).grid(row=0, column=1, padx=12)

        # ---- target
        right = ctk.CTkFrame(wrap, fg_color=self.T["card"], corner_radius=12,
                             border_width=1, border_color=self.T["line"])
        right.grid(row=0, column=2, sticky="nsew")
        right.grid_columnconfigure(0, weight=1)
        right.grid_rowconfigure(1, weight=1)

        self.tgt_picker = LanguagePicker(
            right, self.T, value=self.app.cfg.get("target_lang", "zh"),
            on_change=self._target_lang_changed,
        )
        self.tgt_picker.grid(row=0, column=0, sticky="w", padx=14, pady=(14, 8))

        self.output = ctk.CTkTextbox(
            right, fg_color=self.T["card"], text_color=self.T["accent"],
            border_width=0, wrap="word", font=("", 15),
        )
        self.output.grid(row=1, column=0, sticky="nsew", padx=14, pady=0)
        self.output.configure(state="disabled")

        foot_r = ctk.CTkFrame(right, fg_color="transparent")
        foot_r.grid(row=2, column=0, sticky="ew", padx=14, pady=(4, 12))
        foot_r.grid_columnconfigure(0, weight=1)
        self.attribution = ctk.CTkLabel(foot_r, text="Translated by Local LLM",
                                        font=("", 11), text_color=self.T["accent"])
        self.attribution.grid(row=0, column=0, sticky="w")
        ctk.CTkButton(foot_r, text="Copy", width=60, height=26, corner_radius=6,
                      fg_color="transparent", hover_color=self.T["card2"],
                      text_color=self.T["muted"], font=("", 11),
                      command=self._copy).grid(row=0, column=1, sticky="e")

    def _button(self):
        row = ctk.CTkFrame(self, fg_color="transparent")
        row.grid(row=3, column=0, sticky="ew", padx=28, pady=(14, 10))
        row.grid_columnconfigure(0, weight=1)

        self.go = ctk.CTkButton(
            row, text="Translate", height=44, corner_radius=10,
            fg_color=self.T["accent"], hover_color=self.T["accent2"],
            text_color=self.T["on_accent"], font=("", 15, "bold"),
            command=self.translate,
        )
        self.go.grid(row=0, column=0, sticky="ew")

        # Bind Ctrl+Enter on the toplevel: CTkFrame forbids bind_all().
        self.after(0, self._bind_shortcut)

    def _bind_shortcut(self):
        try:
            self.winfo_toplevel().bind("<Control-Return>", lambda _e: self.translate())
        except Exception:                                   # noqa: BLE001
            pass  # shortcut is a convenience; never block startup on it

    # -------------------------------------------------------------- behaviour
    def _clear_placeholder(self, _event=None):
        if self._placeholder_on:
            self.source.delete("1.0", "end")
            self._placeholder_on = False

    def _on_source_changed(self, _event=None):
        self._placeholder_on = False
        text = self.source.get("1.0", "end").strip()
        self.counter.configure(text=f"{len(text)} / {CHAR_LIMIT}")

        # Auto-detect only supplies a *default* target. Once the user has picked
        # a target themselves that choice must stand — otherwise selecting
        # English for, say, Tamil input silently translates to Chinese instead.
        if self.src_picker.get() == AUTO_CODE and not self._target_user_set:
            found = detect(text) if text else None
            want = L.default_target(found)
            if self.tgt_picker.get() != want:
                self.tgt_picker.set(want)

    def _source_lang_changed(self, code: str):
        # A new source language re-arms the default; the old target choice was
        # made for a different pair.
        self._target_user_set = False
        self._sync_target_default()

    def _target_lang_changed(self, code: str):
        self._target_user_set = True
        self.app.cfg["target_lang"] = code
        self.app.cfg["target_lang_explicit"] = True
        self.app.persist()

    def _sync_target_default(self):
        """Move the target picker to the default opposite of the source."""
        if self.src_picker.get() == AUTO_CODE:
            text = self.source.get("1.0", "end").strip()
            self.tgt_picker.set(L.default_target(detect(text) if text else None))
            return
        self.tgt_picker.set(L.default_target(self.src_picker.get()))

    def _effective_target(self) -> str:
        """The language to translate into.

        The picker is the single source of truth. Auto-detection only decides
        what the picker shows by default (see ``_on_source_changed``), so an
        explicit user choice is never overridden.
        """
        return self.tgt_picker.get()

    def _swap(self):
        src = self.src_picker.get()
        tgt = self.tgt_picker.get()
        out_text = self.output.get("1.0", "end").strip()

        if src != AUTO_CODE:
            self.src_picker.set(tgt)
            self.tgt_picker.set(src)
        else:
            self.src_picker.set(tgt)
            self.tgt_picker.set("en" if tgt != "en" else "zh")

        if out_text and out_text != "...":
            self._placeholder_on = False
            self.source.delete("1.0", "end")
            self.source.insert("1.0", out_text)
            self._on_source_changed()

    def _clear(self):
        self.source.delete("1.0", "end")
        self._placeholder_on = False
        self.counter.configure(text=f"0 / {CHAR_LIMIT}")
        self.output.configure(state="normal")
        self.output.delete("1.0", "end")
        self.output.configure(state="disabled")

    def _copy(self):
        text = self.output.get("1.0", "end").strip()
        if text and text != "...":
            self.clipboard_clear()
            self.clipboard_append(text)
            self.toast.show("Copied to clipboard", "ok")

    # -------------------------------------------------------------- translate
    def translate(self):
        if self.busy:
            return
        text = self.source.get("1.0", "end").strip()
        if not text or self._placeholder_on:
            self.toast.show("Type something to translate", "err")
            return
        if not self.app.engine.ready:
            self.toast.show("Model is still loading — please wait", "err")
            return

        target = self._effective_target()
        self.busy = True
        self.go.configure(state="disabled", text="Translating...")
        self.output.configure(state="normal", text_color=self.T["muted"])
        self.output.delete("1.0", "end")
        self.output.insert("1.0", "…")
        self.output.configure(state="disabled")

        def work():
            try:
                result = self.app.engine.translate(text, target)
            except Exception as exc:                      # noqa: BLE001
                # Bind the message NOW: the lambda runs later, after Python has
                # deleted `exc`, which would raise NameError and wedge the UI.
                message = str(exc)
                self.after(0, lambda: self._on_error(message))
            else:
                self.after(0, lambda: self._on_done(text, result, target))

        threading.Thread(target=work, daemon=True).start()

    def _on_done(self, source: str, result: str, target: str):
        self.output.configure(state="normal", text_color=self.T["accent"])
        self.output.delete("1.0", "end")
        self.output.insert("1.0", result)
        self.output.configure(state="disabled")
        self.go.configure(state="normal", text="Translate")
        self.busy = False

        src = self.src_picker.get()
        direction = f"{src} → {target}" if src != AUTO_CODE else f"auto → {target}"
        self.app.record_history(source, result, direction)
        self.toast.show("Translation complete", "ok")

    def _on_error(self, message: str):
        self.output.configure(state="normal", text_color=self.T["err"])
        self.output.delete("1.0", "end")
        self.output.insert("1.0", f"[Error] {message}")
        self.output.configure(state="disabled")
        self.go.configure(state="normal", text="Translate")
        self.busy = False
        self.toast.show(message, "err")

    # ----------------------------------------------------------------- theme
    def refresh_theme(self, theme: dict):
        self.T = theme
        self.configure(fg_color=self.T["sidebar"])
        self.toast.refresh_theme(self.T)
        self.src_picker.refresh_theme(self.T)
        self.tgt_picker.refresh_theme(self.T)
        self.source.configure(text_color=self.T["text"])
        self.output.configure(text_color=self.T["accent"])
        self.counter.configure(text_color=self.T["faint"])
        self.attribution.configure(text_color=self.T["accent"])
        self.go.configure(fg_color=self.T["accent"], hover_color=self.T["accent2"],
                          text_color=self.T["on_accent"])
