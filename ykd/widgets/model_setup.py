"""First-run model setup.

Shown when no model file is present. Offers to download the 4.3 GB GGUF, with
progress, speed, cancellation and a clear error path. Nothing here is
destructive: the download goes to ``~/.ykd-ai/models/`` and can be deleted from
Settings afterwards.
"""

from __future__ import annotations

import threading

import customtkinter as ctk

from .. import model_store


class ModelSetupOverlay(ctk.CTkFrame):
    """A modal-ish panel covering its parent while the model is missing."""

    def __init__(self, master, app, on_ready=None):
        super().__init__(master, fg_color=app.T["canvas"], corner_radius=0)
        self.app = app
        self.T = app.T
        self._on_ready = on_ready
        self._cancel = threading.Event()
        self._downloading = False

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        card = ctk.CTkFrame(self, fg_color=self.T["card"], corner_radius=14,
                            border_width=1, border_color=self.T["line"])
        card.grid(row=0, column=0)
        self._card = card

        ctk.CTkLabel(card, text="Set up the translation model",
                     font=("", 19, "bold"),
                     text_color=self.T["text"]).pack(anchor="w", padx=28, pady=(26, 6))

        ctk.CTkLabel(
            card,
            text=("YKD AI runs a local model so your text never leaves this "
                  "machine.\nThe model is a one-time 4.3 GB download."),
            font=("", 12), text_color=self.T["muted"], justify="left",
        ).pack(anchor="w", padx=28, pady=(0, 16))

        info = ctk.CTkFrame(card, fg_color=self.T["card2"], corner_radius=8)
        info.pack(fill="x", padx=28, pady=(0, 16))
        for label, value in [
            ("Model", "Hunyuan-MT-7B (Q4_K_M)"),
            ("Languages", "38, including Tamil, Chinese and English"),
            ("Licence", model_store.MODEL_LICENSE),
        ]:
            row = ctk.CTkFrame(info, fg_color="transparent")
            row.pack(fill="x", padx=12, pady=3)
            ctk.CTkLabel(row, text=label, font=("", 11), text_color=self.T["faint"],
                         width=80, anchor="w").pack(side="left")
            ctk.CTkLabel(row, text=value, font=("", 11),
                         text_color=self.T["text"], anchor="w").pack(side="left")

        self.progress = ctk.CTkProgressBar(card, height=8, corner_radius=4,
                                           progress_color=self.T["accent"])
        self.progress.set(0)
        self.progress.pack(fill="x", padx=28, pady=(4, 4))
        self.progress.pack_forget()

        self.status = ctk.CTkLabel(card, text="", font=("", 11),
                                   text_color=self.T["muted"], anchor="w")
        self.status.pack(fill="x", padx=28)
        self.status.pack_forget()

        self.buttons = ctk.CTkFrame(card, fg_color="transparent")
        self.buttons.pack(fill="x", padx=28, pady=(14, 24))

        self.primary = ctk.CTkButton(
            self.buttons, text="Download model", height=38, corner_radius=8,
            fg_color=self.T["accent"], hover_color=self.T["accent2"],
            text_color=self.T["on_accent"], font=("", 13, "bold"),
            command=self.start_download,
        )
        self.primary.pack(side="left")

        self.secondary = ctk.CTkButton(
            self.buttons, text="Quit", height=38, corner_radius=8,
            fg_color="transparent", hover_color=self.T["card2"],
            text_color=self.T["muted"], font=("", 13),
            command=lambda: self.app.destroy(),
        )
        self.secondary.pack(side="left", padx=(8, 0))

    # ------------------------------------------------------------- download
    def start_download(self):
        if self._downloading:
            return
        ok, detail = model_store.disk_space_ok()
        if not ok:
            self._error(detail)
            return

        self._downloading = True
        self._cancel.clear()
        self.primary.configure(state="disabled", text="Downloading…")
        self.secondary.configure(text="Cancel", command=self.cancel_download)
        self.progress.set(0)
        self.progress.pack(fill="x", padx=28, pady=(4, 4))
        self.status.configure(text="Starting…", text_color=self.T["muted"])
        self.status.pack(fill="x", padx=28)

        model_store.download(
            on_progress=lambda done, total, speed: self.after(
                0, lambda: self._progress(done, total, speed)),
            on_done=lambda path: self.after(0, lambda: self._done(path)),
            on_error=lambda msg: self.after(0, lambda: self._error(msg)),
            cancel=self._cancel,
        )

    def cancel_download(self):
        self._cancel.set()
        self._downloading = False
        self.primary.configure(state="normal", text="Download model")
        self.secondary.configure(text="Quit",
                                 command=lambda: self.app.destroy())
        self.progress.pack_forget()
        self.status.configure(text="Download cancelled", text_color=self.T["muted"])

    def _progress(self, done: int, total: int, speed: float):
        if total:
            self.progress.set(min(done / total, 1.0))
        pct = f"{100 * done / total:.0f}%" if total else model_store.human(done)
        self.status.configure(
            text=f"{pct}  ·  {model_store.human(done)} of "
                 f"{model_store.human(total)}  ·  {model_store.human(speed)}/s",
            text_color=self.T["muted"],
        )

    def _done(self, path):
        self._downloading = False
        self.progress.set(1.0)
        self.status.configure(text="Model ready", text_color=self.T["accent"])
        if self._on_ready:
            self._on_ready()

    def _error(self, message: str):
        self._downloading = False
        self.primary.configure(state="normal", text="Try again")
        self.secondary.configure(text="Quit",
                                 command=lambda: self.app.destroy())
        self.status.configure(text=message, text_color=self.T["err"])

    # ---------------------------------------------------------------- theme
    def refresh_theme(self, theme: dict):
        self.T = theme
        self.configure(fg_color=self.T["canvas"])
