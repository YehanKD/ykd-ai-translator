"""End-to-end engine test: real subprocess, real model, all 38 languages.

Run: build-venv/bin/python tests/test_engine_live.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ykd.engine import Engine, STATE_FAILED, STATE_READY
from ykd.languages import LANGS

SOURCE = "The package arrived damaged, so I need a refund."


def main() -> int:
    states = []
    engine = Engine(on_state=states.append)

    print("starting engine (loading 4.3 GB model)...")
    t0 = time.time()
    engine.start()

    while time.time() - t0 < 240:
        if engine.state in (STATE_READY, STATE_FAILED):
            break
        time.sleep(0.5)

    print(f"state={engine.state} after {time.time() - t0:.1f}s")
    if engine.state == STATE_FAILED:
        print("FAILED:", engine.last_error)
        engine.stop()
        return 1

    print(f"states seen: {states}")

    passed, failed = 0, []
    t_all = time.time()
    for code, english, native, _flag, weak in LANGS:
        label = f"{english} ({native})" if weak else english
        try:
            t1 = time.time()
            out = engine.translate(SOURCE, code)
            sec = time.time() - t1
            if out.strip():
                passed += 1
                print(f"  {code:8} {sec:5.2f}s  {out[:60]}")
            else:
                failed.append((code, "empty"))
        except Exception as exc:                       # noqa: BLE001
            failed.append((code, f"{type(exc).__name__}: {exc}"))

    total = time.time() - t_all
    print(f"\nPASS {passed}/{len(LANGS)} in {total:.1f}s "
          f"(avg {total / len(LANGS):.2f}s)")
    if failed:
        print("FAILURES:")
        for code, why in failed:
            print(f"  {code}: {why}")

    engine.stop()
    print("engine stopped cleanly")
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
