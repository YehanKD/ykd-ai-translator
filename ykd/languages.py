"""The 38 languages supported by Hunyuan-MT-7B.

Each row: (code, English name, native name, flag, weak)

``weak`` marks languages where the model is unreliable when prompted with the
English name — Kazakh, for example, silently returns Ukrainian. For these the
prompt uses the native name (``Kazakh (Қазақша)``), which fixes the fallback.
They are also flagged as experimental in the UI.
"""

from __future__ import annotations

# (code, english_name, native_name, flag, weak)
LANGS: list[tuple[str, str, str, str, bool]] = [
    ("zh",      "Chinese (Simplified)",  "中文",             "🇨🇳", False),
    ("en",      "English",               "English",          "🇬🇧", False),
    ("fr",      "French",                "Français",         "🇫🇷", False),
    ("pt",      "Portuguese",            "Português",        "🇵🇹", False),
    ("es",      "Spanish",               "Español",          "🇪🇸", False),
    ("ja",      "Japanese",              "日本語",            "🇯🇵", False),
    ("tr",      "Turkish",               "Türkçe",           "🇹🇷", False),
    ("ru",      "Russian",               "Русский",          "🇷🇺", False),
    ("ar",      "Arabic",                "العربية",          "🇸🇦", False),
    ("ko",      "Korean",                "한국어",            "🇰🇷", False),
    ("th",      "Thai",                  "ไทย",              "🇹🇭", False),
    ("it",      "Italian",               "Italiano",         "🇮🇹", False),
    ("de",      "German",                "Deutsch",          "🇩🇪", False),
    ("vi",      "Vietnamese",            "Tiếng Việt",       "🇻🇳", False),
    ("ms",      "Malay",                 "Bahasa Melayu",    "🇲🇾", False),
    ("id",      "Indonesian",            "Bahasa Indonesia", "🇮🇩", False),
    ("tl",      "Filipino",              "Filipino",         "🇵🇭", False),
    ("hi",      "Hindi",                 "हिन्दी",            "🇮🇳", False),
    ("zh-Hant", "Traditional Chinese",   "繁體中文",          "🇹🇼", False),
    ("pl",      "Polish",                "Polski",           "🇵🇱", False),
    ("cs",      "Czech",                 "Čeština",          "🇨🇿", False),
    ("nl",      "Dutch",                 "Nederlands",       "🇳🇱", False),
    ("km",      "Khmer",                 "ភាសាខ្មែរ",         "🇰🇭", True),
    ("my",      "Burmese",               "မြန်မာဘာသာ",        "🇲🇲", True),
    ("fa",      "Persian",               "فارسی",            "🇮🇷", False),
    ("gu",      "Gujarati",              "ગુજરાતી",           "🇮🇳", False),
    ("ur",      "Urdu",                  "اردو",             "🇵🇰", False),
    ("te",      "Telugu",                "తెలుగు",            "🇮🇳", False),
    ("mr",      "Marathi",               "मराठी",             "🇮🇳", False),
    ("he",      "Hebrew",                "עברית",            "🇮🇱", False),
    ("bn",      "Bengali",               "বাংলা",             "🇧🇩", False),
    ("ta",      "Tamil",                 "தமிழ்",             "🇱🇰", False),
    ("uk",      "Ukrainian",             "Українська",       "🇺🇦", False),
    ("bo",      "Tibetan",               "བོད་ཡིག",           "🇨🇳", True),
    ("kk",      "Kazakh",                "Қазақша",          "🇰🇿", True),
    ("mn",      "Mongolian",             "Монгол хэл",       "🇲🇳", True),
    ("ug",      "Uyghur",                "ئۇيغۇرچە",         "🇨🇳", True),
    ("yue",     "Cantonese",             "粵語",              "🇭🇰", True),
]

# Fast lookups
_BY_CODE = {row[0]: row for row in LANGS}

# Chinese-family codes that should translate *into* English by default
_ZH_FAMILY = ("zh", "zh-Hant", "yue")


def by_code(code: str) -> tuple | None:
    """Return the full row for a language code, or None."""
    return _BY_CODE.get(code)


def name(code: str) -> str:
    """English display name for a language code."""
    row = _BY_CODE.get(code)
    return row[1] if row else code


def flag(code: str) -> str:
    """Flag emoji for a language code."""
    row = _BY_CODE.get(code)
    return row[3] if row else "🏳"


def is_weak(code: str) -> bool:
    """True when the model needs the native name to behave."""
    row = _BY_CODE.get(code)
    return bool(row and row[4])


def prompt_name(code: str) -> str:
    """The language name to embed in the translation prompt.

    Weak languages get their native name appended so the model does not drift
    into a neighbouring language.
    """
    row = _BY_CODE.get(code)
    if not row:
        return code
    _code, english, native, _flag, weak = row
    return f"{english} ({native})" if weak else english


def label(code: str) -> str:
    """``🇰🇿 Kazakh`` style label for the language picker."""
    return f"{flag(code)} {name(code)}"


def default_target(source_code: str | None) -> str:
    """Pick the target language for a detected source.

    Default pair is English -> Chinese; when the source is already Chinese
    (Simplified, Traditional or Cantonese) the target becomes English.
    """
    if source_code in _ZH_FAMILY:
        return "en"
    return "zh"
