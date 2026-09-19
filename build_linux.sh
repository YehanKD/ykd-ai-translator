# Build the YKD AI Translator as a Linux AppImage.
#
# Two flavours:
#   ./build_linux.sh          full  - bundles the 4.3 GB model  (~5 GB image)
#   ./build_linux.sh --lite   lite  - no model; downloads on first run (~1.6 GB)
#
# The lite flavour is what fits a GitHub release (2 GiB per-asset limit).
set -euo pipefail

LITE=0
for arg in "$@"; do
  case "$arg" in
    --lite) LITE=1 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

VENV="./build-venv"
PY="$VENV/bin/python"
APP_NAME="YKD_AI_Translator"

echo "==> checking prerequisites"
[[ -x "$PY" ]]                 || { echo "ERROR: $PY missing. Create it: python3 -m venv build-venv"; exit 1; }
[[ -d runtime/linux ]]         || { echo "ERROR: runtime/linux missing (see README)"; exit 1; }
if [[ "$LITE" -eq 0 ]]; then
  [[ -f models/Hy-MT2-7B-Q4_K_M.gguf ]] || { echo "ERROR: model missing in models/ (or use --lite)"; exit 1; }
fi
[[ -x appimagetool-x86_64.AppImage ]] || { echo "ERROR: appimagetool-x86_64.AppImage missing"; exit 1; }

echo "==> ensuring pyinstaller + deps"
"$PY" -m pip install -q --upgrade pyinstaller customtkinter pillow requests pytest

echo "==> cleaning previous build"
rm -rf build dist AppDir "$APP_NAME.spec"

echo "==> running unit tests"
"$PY" -m pytest tests/test_detect.py tests/test_languages.py -q

echo "==> pyinstaller ($([[ $LITE -eq 1 ]] && echo lite || echo full))"
DATA_ARGS=(--add-data "runtime:runtime" --add-data "ykd/assets:ykd/assets")
if [[ "$LITE" -eq 0 ]]; then
  DATA_ARGS+=(--add-data "models:models")
fi

"$PY" -m PyInstaller \
  --noconfirm --windowed --name "$APP_NAME" \
  "${DATA_ARGS[@]}" \
  --hidden-import customtkinter \
  --hidden-import PIL \
  --hidden-import PIL._tkinter_finder \
  --hidden-import requests \
  translator.py

echo "==> assembling AppDir"
mkdir -p AppDir/usr/bin \
         AppDir/usr/share/applications \
         AppDir/usr/share/icons/hicolor/256x256/apps
cp -r dist/"$APP_NAME"/* AppDir/usr/bin/

# appimagetool REQUIRES the .desktop at the AppDir root, not only under usr/share.
cp packaging/ykd-ai-translator.desktop AppDir/ykd-ai-translator.desktop
cp packaging/ykd-ai-translator.png     AppDir/ykd-ai-translator.png
cp packaging/ykd-ai-translator.desktop AppDir/usr/share/applications/
cp packaging/ykd-ai-translator.png     AppDir/usr/share/icons/hicolor/256x256/apps/

cat > AppDir/AppRun <<'EOF'
#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"
exec "${HERE}/usr/bin/YKD_AI_Translator" "$@"
EOF
chmod +x AppDir/AppRun

SUFFIX=""
[[ "$LITE" -eq 1 ]] && SUFFIX="-lite"

echo "==> appimagetool"
ARCH=x86_64 ./appimagetool-x86_64.AppImage --no-appstream AppDir "$APP_NAME$SUFFIX.AppImage"

chmod +x "$APP_NAME$SUFFIX.AppImage"
echo
echo "==> DONE: $HERE/$APP_NAME$SUFFIX.AppImage"
ls -lh "$APP_NAME$SUFFIX.AppImage"
echo
echo "Verify by running it — a build that succeeds says nothing about runtime:"
echo "  ./$APP_NAME$SUFFIX.AppImage"
