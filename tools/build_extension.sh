# Package the Chrome extension as a zip for distribution or the Web Store.
#
#   ./tools/build_extension.sh
#
# Produces ykd-1688-translator-v<version>.zip in the project root.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

[[ -f extension/manifest.json ]] || { echo "ERROR: extension/manifest.json missing"; exit 1; }

VERSION=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
OUT="ykd-1688-translator-v${VERSION}.zip"

echo "==> checking manifest references resolve"
python3 - <<'PY'
import json, os, sys
m = json.load(open("extension/manifest.json"))
missing = []

def walk(node):
    if isinstance(node, dict):
        for v in node.values():
            walk(v)
    elif isinstance(node, list):
        for v in node:
            walk(v)
    elif isinstance(node, str):
        if "://" in node or node.startswith("*"):
            return
        if any(node.endswith(e) for e in (".js", ".css", ".html", ".png")):
            if not os.path.exists(os.path.join("extension", node)):
                missing.append(node)

walk(m)
if missing:
    print("  MISSING:", missing)
    sys.exit(1)
print("  all referenced files present")
PY

echo "==> syntax-checking JavaScript"
while IFS= read -r f; do
  node --check "$f" >/dev/null || { echo "  SYNTAX ERROR in $f"; exit 1; }
done < <(find extension -name "*.js")
echo "  all files parse"

echo "==> running extension tests"
node tests/extension/translate.test.mjs >/dev/null
node tests/extension/replace.test.mjs >/dev/null
echo "  tests pass"

echo "==> packaging"
rm -f "$OUT"
# Exclude the README: it is for the repository, not the shipped extension.
(cd extension && zip -qr "../$OUT" . -x "README.md" -x "*.DS_Store")

echo
echo "==> DONE: $HERE/$OUT"
ls -lh "$OUT"
echo
echo "Load it with: chrome://extensions -> Developer mode -> Load unpacked -> extension/"
echo "Or upload the zip to the Chrome Web Store."
