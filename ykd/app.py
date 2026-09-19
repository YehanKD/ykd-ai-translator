"""The YKD AI application shell.

Sidebar navigation (Translate / History / Settings), a model-status indicator,
and the engine lifecycle. Matches Figma node 9:16.
"""

from __future__ import annotations

import sys
import threading
from datetime import datetime

import customtkinter as ctk

from . import APP_TITLE, APP_VERSION, config
from .engine import (
    STATE_FAILED,
    STATE_IDLE,
    STATE_LOADING,
    STATE_READY,
    Engine,
)
from .icons import icon_image
from .model_store import model_present
from .pages.history import HistoryPage
from .pages.settings import SettingsPage
from .pages.translate import TranslatePage
from .theme import palette

SIDEBAR_WIDTH = 180
SIDEBAR_RAIL_WIDTH = 52       # collapsed width, per the Figma rail frame (9:67)
# (label, icon name) — icons are drawn in ykd/icons.py to match the design,
# because Unicode lookalikes do not match the Figma glyphs.
NAV_ITEMS = [("Translate", "translate"), ("History", "history"), ("Settings", "settings")]


class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.cfg = config.load()
        self.T = palette(self.cfg.get("theme", "dark"))

        self.title(APP_TITLE)
        self.geometry("1100x720")
        self.minsize(900, 600)
        self.configure(fg_color=self.T["canvas"])

        self.engine = Engine(on_state=self._engine_state_from_thread)
        self._pages: dict[str, ctk.CTkFrame] = {}
        self._nav_buttons: dict[str, ctk.CTkButton] = {}
        self._active = "Translate"
        self._clip_on = False
        self._last_clip = ""

        self._build()
        self._apply_theme()

        if self.cfg.get("always_on_top"):
            self.attributes("-topmost", True)

        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # First run with no model: ask for the download instead of failing.
        if model_present():
            self.after(200, self.engine.start)
        else:
            self.after(250, self._show_model_setup)

        if self.cfg.get("auto_clipboard"):
            self.set_clipboard_watch(True)

    # ------------------------------------------------------------ first run
    def _show_model_setup(self):
        from .widgets.model_setup import ModelSetupOverlay

        overlay = ModelSetupOverlay(self, self, on_ready=self._model_ready)
        overlay.grid(row=0, column=0, columnspan=2, sticky="nsew")
        overlay.lift()
        self._model_overlay = overlay

    def _model_ready(self):
        """Called once the model download finishes."""
        overlay = getattr(self, "_model_overlay", None)
        if overlay is not None:
            overlay.destroy()
            self._model_overlay = None
        self.engine.start()

    # ------------------------------------------------------------------ build
    def _build(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Sidebar always starts collapsed (the rail), per the design.
        self._collapsed = True
        self.sidebar = ctk.CTkFrame(self, width=SIDEBAR_RAIL_WIDTH, corner_radius=0)
        self.sidebar.grid(row=0, column=0, sticky="nsw")
        # The sidebar's children are managed by pack(), so pack_propagate is
        # what stops them from stretching the frame; grid_propagate does not
        # apply to pack-managed children.
        self.sidebar.pack_propagate(False)
        self.sidebar.grid_propagate(False)

        # brand row: logo box + wordmark
        brand = ctk.CTkFrame(self.sidebar, fg_color="transparent", height=26)
        brand.pack(fill="x", padx=12, pady=(16, 0))
        brand.pack_propagate(False)
        self._brand_row = brand

        self.brand_box = ctk.CTkLabel(
            brand, text="YKD", width=34, height=26, corner_radius=6,
            font=("", 11, "bold"), text_color="#ffffff", fg_color=self.T["accent"],
        )
        self.brand_box.pack(side="left")

        self.brand_text = ctk.CTkLabel(brand, text="YKD AI", font=("", 14, "bold"))
        self.brand_text.pack(side="left", padx=(8, 0))

        # Collapse toggle on its OWN row below the logo, matching the design
        # (Figma: logo y=0, sidebar-collapse-toggle y=35). A 52px rail has no
        # room to put the logo and the chevron side by side.
        toggle_row = ctk.CTkFrame(self.sidebar, fg_color="transparent", height=24)
        toggle_row.pack(fill="x", padx=12, pady=(9, 0))
        toggle_row.pack_propagate(False)
        self._toggle_row = toggle_row

        self.collapse_btn = ctk.CTkButton(
            toggle_row, text="", width=24, height=24, corner_radius=6,
            fg_color="transparent", hover_color=self.T["card2"],
            command=self.toggle_sidebar,
        )
        self.collapse_btn.pack(side="right")
        self._collapse_icon = None

        # nav
        self._nav_icons: dict[str, object] = {}
        for name, icon_name in NAV_ITEMS:
            img = icon_image(icon_name, 15, self.T["muted"])
            self._nav_icons[name] = img
            btn = ctk.CTkButton(
                self.sidebar, text=f"   {name}", image=img, compound="left",
                anchor="w", height=38,
                corner_radius=8, fg_color="transparent", hover_color=self.T["card2"],
                font=("", 13), command=lambda n=name: self.show(n),
            )
            btn.pack(fill="x", padx=10, pady=2)
            self._nav_buttons[name] = btn

        # status pinned to the bottom
        self.status_row = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        self.status_row.pack(side="bottom", fill="x", padx=16, pady=14)
        self.status_dot = ctk.CTkLabel(self.status_row, text="●", font=("", 13))
        self.status_dot.pack(side="left")
        self.status_text = ctk.CTkLabel(self.status_row, text="Starting…", font=("", 11))
        self.status_text.pack(side="left", padx=(6, 0))

        # content
        self.content = ctk.CTkFrame(self, fg_color=self.T["sidebar"], corner_radius=0)
        self.content.grid(row=0, column=1, sticky="nsew")
        self.content.grid_columnconfigure(0, weight=1)
        self.content.grid_rowconfigure(0, weight=1)

        self._build_pages()
        self.show("Translate")
        self._apply_sidebar_state()

    def _build_pages(self):
        """Create every page. Rebuilt wholesale on a theme switch."""
        for name, cls in [
            ("Translate", TranslatePage),
            ("History", HistoryPage),
            ("Settings", SettingsPage),
        ]:
            page = cls(self.content, self)
            page.grid(row=0, column=0, sticky="nsew")
            self._pages[name] = page

    # ------------------------------------------------------------------- nav
    def show(self, name: str):
        self._active = name
        self._pages[name].tkraise()
        if name == "History":
            self._pages["History"].render()
        self._paint_nav()

    # -------------------------------------------------------------- sidebar
    def toggle_sidebar(self):
        """Collapse the sidebar to an icon rail, or expand it."""
        self._collapsed = not self._collapsed
        self._apply_sidebar_state()

    def _apply_sidebar_state(self):
        """Render the sidebar in its collapsed (rail) or expanded form.

        Collapsed: 52px rail, icon-only nav, logo box without the wordmark,
        chevron pointing right. Expanded: 180px, labels shown, chevron left.

        The width is enforced by grid column ``minsize`` AND the frame's own
        width; ``grid_propagate(False)`` alone is not enough because the child
        buttons keep requesting their full width and stretch the frame.
        """
        collapsed = self._collapsed
        width = SIDEBAR_RAIL_WIDTH if collapsed else SIDEBAR_WIDTH

        self.sidebar.configure(width=width)
        self.grid_columnconfigure(0, minsize=width, weight=0)

        # the wordmark only fits when expanded
        if collapsed:
            self.brand_text.pack_forget()
        else:
            self.brand_text.pack(side="left", padx=(8, 0))

        # status text is too wide for the rail; keep just the dot
        if collapsed:
            self.status_text.pack_forget()
            self.status_row.pack_configure(padx=18)
        else:
            self.status_text.pack(side="left", padx=(6, 0))
            self.status_row.pack_configure(padx=16)

        # Nav rows must not request more width than the rail: pass a small
        # fixed width when collapsed and let the row fill when expanded.
        inner = width - 20          # 10px padding each side
        for name, _icon in NAV_ITEMS:
            btn = self._nav_buttons[name]
            if collapsed:
                btn.configure(text="", anchor="center", width=32)
                btn.pack_configure(padx=10, fill=None)
            else:
                btn.configure(text=f"   {name}", anchor="w", width=inner)
                btn.pack_configure(padx=10, fill="x")

        # brand row padding keeps the logo box aligned in both states
        self._brand_row.pack_configure(padx=9 if collapsed else 12)
        # the toggle row aligns the chevron under the logo in the rail, and to
        # the right edge when expanded
        self._toggle_row.pack_configure(padx=14 if collapsed else 12)
        self.collapse_btn.pack_configure(side="right" if not collapsed else "left")
        self._paint_nav()

    def _paint_nav(self):
        """Colour the nav rows and re-render their icons in the matching colour."""
        for key, btn in self._nav_buttons.items():
            active = key == self._active
            colour = self.T["accent"] if active else self.T["muted"]
            icon_name = dict(NAV_ITEMS)[key]
            img = icon_image(icon_name, 15, colour)
            self._nav_icons[key] = img          # keep the ref alive
            btn.configure(
                fg_color=self.T["nav_active_bg"] if active else "transparent",
                text_color=colour,
                image=img,
            )

        # the collapse chevron points the way the sidebar will move
        name = "chevron-right" if self._collapsed else "chevron-left"
        icon = icon_image(name, 14, self.T["muted"])
        self._collapse_icon = icon
        self.collapse_btn.configure(image=icon)

    # --------------------------------------------------------------- engine
    def _engine_state_from_thread(self, state: str):
        """Engine callbacks arrive off the UI thread — marshal before touching widgets."""
        self.after(0, lambda: self._apply_engine_state(state))

    def _apply_engine_state(self, state: str):
        mapping = {
            STATE_IDLE: ("●", self.T["faint"], "Stopped"),
            STATE_LOADING: ("●", self.T["muted"], "Loading model…"),
            STATE_READY: ("●", self.T["accent"], "Local Model Ready"),
            STATE_FAILED: ("●", self.T["err"], "Model failed to load"),
        }
        dot, colour, text = mapping.get(state, mapping[STATE_IDLE])
        self.status_dot.configure(text_color=colour)
        self.status_text.configure(text=text, text_color=colour)

        if state == STATE_FAILED and self.engine.last_error:
            page = self._pages.get("Translate")
            if page is not None:
                page.toast.show(self.engine.last_error, "err")

    # ---------------------------------------------------------------- theme
    def set_theme(self, mode: str):
        """Request a theme switch.

        Deferred by one event-loop tick: the call comes from a control inside
        the page being destroyed, so tearing the tree down mid-callback would
        kill the widget that is still executing.
        """
        if mode == self.cfg.get("theme") and self._pages:
            return
        self.after(0, lambda m=mode: self._apply_theme_switch(m))

    def _apply_theme_switch(self, mode: str):
        """Rebuild the UI under the new palette.

        Rebuilding is deliberate: CTk widgets bake their colours in at
        construction, so walking the tree to re-colour every frame, border and
        textbox is error-prone (containers silently keep the old palette). A
        rebuild is a few hundred milliseconds and is always correct.
        """
        self.cfg["theme"] = mode
        self.persist()
        self.T = palette(mode)
        self._apply_theme()

        if not self._pages:
            return
        for page in self._pages.values():
            page.destroy()
        self._pages.clear()
        self._build_pages()
        self.show(self._active)

    def _apply_theme(self):
        self.configure(fg_color=self.T["canvas"])
        self.sidebar.configure(fg_color=self.T["sidebar"])
        self.content.configure(fg_color=self.T["sidebar"])
        self.brand_box.configure(fg_color=self.T["accent"])
        self.brand_text.configure(text_color=self.T["text"])
        self.status_text.configure(text_color=self.T["muted"])
        self.collapse_btn.configure(hover_color=self.T["card2"])

        for name, btn in self._nav_buttons.items():
            btn.configure(hover_color=self.T["card2"])
        # Re-applies the sidebar state as well as the nav colours, so a theme
        # switch never silently expands a collapsed sidebar.
        self._apply_sidebar_state()

    # -------------------------------------------------------------- history
    def record_history(self, source: str, translated: str, direction: str):
        config.add_history(
            self.cfg, source, translated, direction,
            "Hunyuan-MT-7B", datetime.now().isoformat(),
        )
        self.persist()

    def persist(self):
        config.save(self.cfg)

    # ------------------------------------------------------------- clipboard
    def set_clipboard_watch(self, enabled: bool):
        self._clip_on = enabled
        if enabled:
            self._poll_clipboard()

    def _poll_clipboard(self):
        if not self._clip_on:
            return
        try:
            current = self.clipboard_get().strip()
        except Exception:                                   # noqa: BLE001
            current = ""
        if current and current != self._last_clip and len(current) >= 5:
            self._last_clip = current
            page = self._pages.get("Translate")
            if page is not None:
                self.show("Translate")
                page.source.delete("1.0", "end")
                page.source.insert("1.0", current)
                page._on_source_changed()
                page.translate()
        self.after(900, self._poll_clipboard)

    # --------------------------------------------------------------- startup
    def launch_command(self) -> str:
        if getattr(sys, "frozen", False):
            return sys.executable
        return f"{sys.executable} {self._entry_script()}"

    @staticmethod
    def _entry_script() -> str:
        from pathlib import Path
        return str(Path(__file__).resolve().parent.parent / "translator.py")

    # ----------------------------------------------------------------- close
    def _on_close(self):
        try:
            self.engine.stop()
        finally:
            self.destroy()


def main():
    ctk.set_appearance_mode("dark")
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
