"""Script-based language detection.

This detects the *script* of the input, not the language. That distinction
matters: several supported languages share a script and cannot be told apart
from character ranges alone.

    Devanagari   -> Hindi or Marathi
    Arabic block -> Arabic, Persian, Urdu or Uyghur
    Han          -> Chinese or Japanese (kana is checked first, so Japanese wins)

For those, ``detect`` returns one representative code and the user's manual
language picker is the override. Do not claim per-language accuracy here.
"""

from __future__ import annotations

import re

# Ordered most-specific-first. Kana and Hangul must precede Han so Japanese and
# Korean are not swallowed by the CJK ideograph range.
_RANGES: list[tuple[str, re.Pattern]] = [
    ("ja", re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")),          # hiragana + katakana
    ("ko", re.compile(r"[\uac00-\ud7af\u1100-\u11ff]")),          # hangul
    ("km", re.compile(r"[\u1780-\u17ff]")),                       # Khmer
    ("my", re.compile(r"[\u1000-\u109f]")),                       # Myanmar
    ("th", re.compile(r"[\u0e00-\u0e7f]")),                       # Thai
    ("bo", re.compile(r"[\u0f00-\u0fff]")),                       # Tibetan
    ("bn", re.compile(r"[\u0980-\u09ff]")),                       # Bengali
    ("gu", re.compile(r"[\u0a80-\u0aff]")),                       # Gujarati
    ("ta", re.compile(r"[\u0b80-\u0bff]")),                       # Tamil
    ("te", re.compile(r"[\u0c00-\u0c7f]")),                       # Telugu
    ("hi", re.compile(r"[\u0900-\u097f]")),                       # Devanagari (hi/mr)
    ("he", re.compile(r"[\u0590-\u05ff]")),                       # Hebrew
    ("ar", re.compile(r"[\u0600-\u06ff\u0750-\u077f]")),          # Arabic block
    ("zh", re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")),          # Han
]

_LATIN = re.compile(r"[A-Za-z]")


def detect(text: str) -> str | None:
    """Best-effort language code for ``text``, or None if the script is unknown."""
    if not text or not text.strip():
        return None
    for code, pattern in _RANGES:
        if pattern.search(text):
            return code
    if _LATIN.search(text):
        return "en"  # Latin script -> assume the default source language
    return None
