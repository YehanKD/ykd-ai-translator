import pytest

from ykd.detect import detect


@pytest.mark.parametrize("text,expected", [
    ("你好世界", "zh"),
    ("Hello world", "en"),
    ("こんにちは", "ja"),
    ("안녕하세요", "ko"),
    ("Привет мир", None),          # Cyrillic is shared -> unknown here
    ("مرحبا بالعالم", "ar"),
    ("नमस्ते दुनिया", "hi"),
    ("สวัสดี", "th"),
    ("ជំរាបសួរ", "km"),
    ("ဟယ်လို", "my"),
    ("హలో", "te"),
    ("હેલો", "gu"),
    ("வணக்கம்", "ta"),
    ("বাংলা", "bn"),
    ("བོད་ཡིག", "bo"),
    ("שלום", "he"),
    ("", None),
    ("   ", None),
    ("12345 !@#$", None),
])
def test_detect(text, expected):
    assert detect(text) == expected


def test_kana_beats_han():
    """Japanese contains Han characters; kana must win."""
    assert detect("私は日本語を話します") == "ja"


def test_hangul_beats_han():
    assert detect("한국어를 말합니다") == "ko"
