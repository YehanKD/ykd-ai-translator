"""YKD AI Translator — entry point.

Kept at the project root so existing launchers (start.bat, desktop files,
AppImage AppRun) keep working unchanged.

The previous single-file implementation is preserved as translator_legacy_v1.py.
"""

from ykd.app import main

if __name__ == "__main__":
    main()
