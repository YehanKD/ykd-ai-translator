import pytest

from ykd.languages import LANGS, default_target, prompt_name
from ykd.prompt import build


def test_language_count():
    assert len(LANGS) == 38


def test_codes_unique():
    codes = [row[0] for row in LANGS]
    assert len(codes) == len(set(codes))


def test_prompt_uses_english_name_for_strong_language():
    assert prompt_name("zh") == "Chinese (Simplified)"
    assert prompt_name("fr") == "French"
    assert prompt_name("ta") == "Tamil"


@pytest.mark.parametrize("code", ["kk", "bo", "ug", "mn", "km", "my", "yue"])
def test_prompt_uses_native_name_for_weak_languages(code):
    assert "(" in prompt_name(code), f"{code} should carry its native name"


def test_kazakh_specifically():
    assert prompt_name("kk") == "Kazakh (Қазақша)"


def test_build_shape():
    p = build("The cat sat.", "zh")
    assert p == (
        "Translate the following segment into Chinese (Simplified), "
        "without additional explanation.\n\nThe cat sat."
    )


def test_build_reverse():
    assert "English" in build("你好", "en")


def test_build_weak_language():
    assert "Kazakh (Қазақша)" in build("hello", "kk")


@pytest.mark.parametrize("source,expected", [
    ("zh", "en"),
    ("zh-Hant", "en"),
    ("yue", "en"),
    ("en", "zh"),
    ("fr", "zh"),
    (None, "zh"),
])
def test_default_target(source, expected):
    assert default_target(source) == expected
