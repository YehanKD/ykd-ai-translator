"""Persistent settings and translation history.

Stored as JSON under ``~/.ykd-ai/config.json`` (override the directory with the
``YKD_CONFIG_DIR`` environment variable — tests use this to stay off the real
user config). History is capped so the file cannot grow without bound.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

CONFIG_DIR = Path(
    os.environ.get("YKD_CONFIG_DIR") or (Path(os.path.expanduser("~")) / ".ykd-ai")
)
CONFIG_FILE = CONFIG_DIR / "config.json"

HISTORY_LIMIT = 200

DEFAULTS = {
    "source_lang": "auto",          # "auto" or a language code
    "target_lang": "zh",
    "target_lang_explicit": False,  # True once the user picks a target themselves
    "theme": "dark",                # "system" | "light" | "dark"
    "auto_clipboard": False,
    "always_on_top": False,
    "launch_at_startup": False,
    "history": [],
}


def load() -> dict:
    """Read config, filling in any missing keys with defaults."""
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
            stored = json.load(fh)
        if isinstance(stored, dict):
            cfg.update(stored)
    except (OSError, ValueError):
        pass  # missing or corrupt -> defaults
    if not isinstance(cfg.get("history"), list):
        cfg["history"] = []
    return cfg


def save(cfg: dict) -> None:
    """Write config atomically so a crash cannot truncate it."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, CONFIG_FILE)


def add_history(cfg: dict, source: str, translated: str, direction: str, model: str,
                timestamp: str) -> None:
    """Prepend a history entry, trimming to HISTORY_LIMIT."""
    entry = {
        "source": source[:2000],
        "translated": translated[:2000],
        "direction": direction,
        "model": model,
        "time": timestamp,
    }
    cfg["history"] = ([entry] + list(cfg.get("history", [])))[:HISTORY_LIMIT]
