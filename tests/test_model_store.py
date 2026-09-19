"""Tests for model discovery and the first-run downloader.

The shipped builds are "lite" (no bundled model), so a missing model must be
detected cleanly and the download must validate what it fetches — a truncated
file or an HTML error page must never be accepted as a model.
"""

import os
import sys
import tempfile
from pathlib import Path

os.environ["YKD_DATA_DIR"] = tempfile.mkdtemp(prefix="ykd-ms-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd import model_store  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def main():
    # This is a source checkout, so models/ really does contain the model.
    # Redirect the "bundled" lookup into an empty dir so these tests exercise
    # the lite-build case (no bundled model) rather than the local checkout.
    empty_bundle = Path(tempfile.mkdtemp(prefix="ykd-bundle-"))
    model_store.bundle_root = lambda: empty_bundle
    check("bundled lookup redirected", model_store.bundled_model_path().parent
          == empty_bundle / "models")

    print("\n1) discovery with nothing installed")
    check("no model found", model_store.find_model() is None)
    check("model_present False", model_store.model_present() is False)
    check("user path is under the data dir",
          str(model_store.user_model_path()).startswith(os.environ["YKD_DATA_DIR"]),
          str(model_store.user_model_path()))

    print("\n2) discovery finds a model in the user directory")
    p = model_store.user_model_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"GGUF" + b"\0" * 1024)
    check("found after writing", model_store.find_model() == p)
    check("model_present True", model_store.model_present() is True)

    print("\n3) an empty file is not a model")
    p.write_bytes(b"")
    check("zero-byte file rejected", model_store.find_model() is None)
    p.unlink()

    print("\n4) size validation rejects truncated and oversized files")
    good = model_store._EXPECTED_BYTES
    check("exact size accepted", model_store._size_ok(good))
    check("1% short accepted (tolerance)", model_store._size_ok(int(good * 0.99)))
    check("half size rejected", not model_store._size_ok(good // 2))
    check("tiny error page rejected", not model_store._size_ok(1234))
    check("zero rejected", not model_store._size_ok(0))
    check("double size rejected", not model_store._size_ok(good * 2))

    print("\n5) disk space check reports something usable")
    ok, detail = model_store.disk_space_ok()
    check("returns a boolean and a message", isinstance(ok, bool) and bool(detail), detail)

    print("\n6) human() formatting")
    check("bytes", model_store.human(512) == "512.0 B", model_store.human(512))
    check("GB", "GB" in model_store.human(4_624_950_272), model_store.human(4_624_950_272))

    print("\n7) downloader rejects a non-GGUF payload")
    # Point the downloader at a tiny local file that is not a GGUF and confirm
    # it errors rather than publishing it as a model.
    import threading
    original_url = model_store.MODEL_URL
    original_expected = model_store._EXPECTED_BYTES
    try:
        # serve a small file from the local filesystem via file:// so no network
        bogus = Path(tempfile.mkdtemp(prefix="ykd-bogus-")) / "notamodel.bin"
        bogus.write_bytes(b"<html>rate limited</html>" * 100)
        model_store.MODEL_URL = bogus.as_uri()
        model_store._EXPECTED_BYTES = bogus.stat().st_size   # size matches...
        errs = []
        done = threading.Event()
        model_store.download(
            on_done=lambda path: (done.set(), errs.append(None)),
            on_error=lambda m: (done.set(), errs.append(m)),
        )
        done.wait(timeout=30)
        target = model_store.user_model_path()
        check("non-GGUF payload rejected", bool(errs) and errs[0] is not None,
              str(errs))
        check("no model published", not target.exists())
        check("no .part left behind",
              not target.with_suffix(target.suffix + ".part").exists())
    finally:
        model_store.MODEL_URL = original_url
        model_store._EXPECTED_BYTES = original_expected

    print("\n8) delete_model removes a downloaded model")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"GGUF" + b"\0" * 2048)
    check("present before delete", model_store.model_present())
    check("delete returns True", model_store.delete_model() is True)
    check("gone after delete", not model_store.model_present())
    check("delete again returns False", model_store.delete_model() is False)

    print()
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL MODEL-STORE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
