"""Prompt construction for Hunyuan-MT-7B.

The model was trained on this segment-level instruction format, and it follows
it more reliably than a verbose system prompt:

    Translate the following segment into <LANGUAGE>, without additional explanation.

    <text>

The target language name is substituted per request, so switching the target
language in the UI changes the prompt accordingly.
"""

from __future__ import annotations

from .languages import prompt_name

TEMPLATE = (
    "Translate the following segment into {lang}, without additional explanation."
    "\n\n{text}"
)


def build(text: str, target_code: str) -> str:
    """Build the translation prompt for ``text`` targeting ``target_code``."""
    return TEMPLATE.format(lang=prompt_name(target_code), text=text)
