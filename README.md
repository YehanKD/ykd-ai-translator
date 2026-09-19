# YKD AI Translator

An offline, multilingual desktop translator. It runs **Hunyuan-MT-7B** entirely on
your own machine — no cloud service, no API key, no account, and no text ever leaves
the computer.

Built with Python and CustomTkinter, with a bundled [llama.cpp](https://github.com/ggml-org/llama.cpp)
runtime that serves the model over a local socket.

## Features

- **38 languages** — bidirectional translation between any pair, including Tamil,
  Chinese (Simplified and Traditional), Cantonese, Japanese, Korean, Arabic, Hindi,
  Thai, Vietnamese, Khmer, Burmese, Tibetan, Uyghur, Mongolian and more.
- **Fully offline** — the model runs locally on your GPU. Nothing is uploaded.
- **Automatic language detection** — paste text and the source language is detected,
  with the target chosen to match. English is the default source; Chinese input
  translates to English.
- **Searchable language picker** — filter the list by typing, with country flags.
- **Translation history** — searchable, capped at the most recent 200 entries.
- **Light and dark themes.**
- **Collapsible sidebar** for a compact workspace.
- **Clipboard mode** — optionally translate whatever you copy.
- **Browser extension** — translate 1688.com (or any allowlisted site) directly in
  Chrome, including seller chat. See [`extension/`](extension/README.md).

## Requirements

| | |
|---|---|
| OS | Linux (x86-64) or Windows 10/11 (x86-64) |
| GPU | NVIDIA with ~6 GB free VRAM (CUDA), or a Vulkan-capable GPU |
| RAM | 8 GB minimum |
| Disk | ~5 GB for the model, plus the application |
| Driver | NVIDIA driver R570 or newer |

The model is 4.3 GB and is downloaded on first launch, so the initial start needs
an internet connection. After that the application works entirely offline.

## Install

### Linux

Download `YKD_AI_Translator-lite.AppImage` from the
[latest release](../../releases/latest), then:

```bash
chmod +x YKD_AI_Translator-lite.AppImage
./YKD_AI_Translator-lite.AppImage
```

On first launch the app offers to download the model (~4.3 GB). It is stored in
`~/.ykd-ai/models/` and reused on every later run.

> If your desktop needs an AppImage integration helper, install
> [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or run the file
> directly as shown above.

### Windows

Download the installer from the [latest release](../../releases/latest) and run it.
The same first-run model download applies.

### Running from source

```bash
git clone https://github.com/YehanKD/ykd-ai-translator.git
cd ykd-ai-translator

python3 -m venv build-venv
./build-venv/bin/pip install customtkinter pillow requests pytest

# fetch the llama.cpp runtime (see "Runtime binaries" below)
# fetch the model into models/ (see "Model" below)

./build-venv/bin/python translator.py
```

## Building

### Linux — AppImage

```bash
./build_linux.sh --lite    # no bundled model  (~1.6 GB, for distribution)
./build_linux.sh           # bundles the model (~5 GB, for personal use)
```

Produces `YKD_AI_Translator-lite.AppImage` or `YKD_AI_Translator.AppImage`.

### Windows

Run on Windows, in PowerShell:

```powershell
.\build_windows.ps1        # PyInstaller onedir build
iscc packaging\ykd.iss     # optional: single-file installer
```

PyInstaller cannot cross-compile a working Windows bundle from Linux, so this step
must run on Windows.

### Runtime binaries

The app ships a prebuilt llama.cpp server. **Both archives are required** — the
plain CUDA build does not include the CUDA runtime, and without it `libggml-cuda.so`
fails to load with `libcudart.so.12 not found`.

```bash
TAG=b11046
BASE=https://github.com/ggml-org/llama.cpp/releases/download/$TAG

# Linux
mkdir -p runtime/linux && cd runtime/linux
curl -sLO $BASE/llama-$TAG-bin-ubuntu-cuda-12.8-x64.tar.gz
tar xzf llama-$TAG-bin-ubuntu-cuda-12.8-x64.tar.gz --strip-components=1
curl -sLO $BASE/cudart-llama-$TAG-bin-ubuntu-cuda-12.8-x64.tar.gz
tar xzf cudart-llama-$TAG-bin-ubuntu-cuda-12.8-x64.tar.gz
cp cudart-llama-$TAG-bin-ubuntu-cuda-12.8-x64/lib{cudart,cublas,cublasLt}.so.12 .
rm -rf *.tar.gz cudart-llama-*/
```

For Windows, fetch `llama-$TAG-bin-win-cuda-12.4-x64.zip` and
`cudart-llama-$TAG-bin-win-cuda-12.4-x64.zip` into `runtime/windows/`.

Check <https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=1> for the
current tag; the assets are published per commit.

### Model

```bash
mkdir -p models
curl -L -o models/Hy-MT2-7B-Q4_K_M.gguf \
  "https://huggingface.co/mradermacher/Hunyuan-MT-7B-GGUF/resolve/main/Hunyuan-MT-7B.Q4_K_M.gguf"
```

## Usage

1. Paste or type text into the left panel. The source language is detected
   automatically.
2. Adjust the target language from the dropdown if needed — the list is searchable.
3. Press **Translate** (or `Ctrl+Enter`).
4. Use the swap button to reverse the direction, and **Copy** to take the result.

### Settings

| Option | Effect |
|---|---|
| Auto-translate clipboard | Translate newly copied text automatically |
| Always on top | Keep the window above other applications |
| Launch at startup | Start the app on login (Linux) |
| Application theme | System, light or dark |

## Configuration

Settings live in `~/.ykd-ai/config.json` and the downloaded model in
`~/.ykd-ai/models/`. Both can be deleted to reset the application.

## Languages

Chinese (Simplified) · English · French · Portuguese · Spanish · Japanese · Turkish ·
Russian · Arabic · Korean · Thai · Italian · German · Vietnamese · Malay ·
Indonesian · Filipino · Hindi · Chinese (Traditional) · Polish · Czech · Dutch ·
Khmer · Burmese · Persian · Gujarati · Urdu · Telugu · Marathi · Hebrew · Bengali ·
Tamil · Ukrainian · Tibetan · Kazakh · Mongolian · Uyghur · Cantonese

Some languages share a writing system, so automatic detection cannot always tell
them apart — Devanagari is used by both Hindi and Marathi, for example, and the
Arabic script by Arabic, Persian, Urdu and Uyghur. Use the dropdown to be explicit
when it matters.

Tibetan, Uyghur, Mongolian, Khmer, Burmese and Kazakh are lower-resource languages.
They work, but expect lower quality than the major languages.

## How it works

```
┌─────────────────┐      HTTP       ┌──────────────────┐
│  CustomTkinter  │ ──────────────▶ │  llama-server    │
│  desktop UI     │    localhost    │  (llama.cpp)     │
└─────────────────┘                 └──────────────────┘
                                            │
                                            ▼
                                   Hunyuan-MT-7B (GGUF)
                                     on the local GPU
```

The application starts `llama-server` as a child process on a free loopback port and
talks to it over the OpenAI-compatible chat completions API. The server is bound to
`127.0.0.1`, so it is not reachable from the network.

Translation uses the instruction format the model was trained on:

```
Translate the following segment into <LANGUAGE>, without additional explanation.

<text>
```

## Development

```
ykd/
  app.py              application shell: sidebar, navigation, engine lifecycle
  engine.py           llama-server subprocess manager and HTTP client
  model_store.py      model discovery, first-run download, validation
  languages.py        the 38-language table
  detect.py           script-based language detection
  prompt.py           prompt construction
  theme.py            light and dark palettes
  config.py           settings persistence
  icons.py            drawn navigation icons and flag images
  assets/flags/       country flag images
  pages/              translate, history, settings
  widgets/            language picker, toast, model setup
runtime/linux|windows llama.cpp binaries
models/               the GGUF model
packaging/            .desktop file, icon, Inno Setup script
extension/            Chrome extension (1688.com and other allowlisted sites)
tools/                maintenance scripts (README screenshot, extension packaging)
tests/                test suite
```

### Tests

```bash
# Fast, no GPU needed
./build-venv/bin/python -m pytest tests/test_detect.py tests/test_languages.py -q
./build-venv/bin/python tests/test_model_store.py

# Requires the model and a GPU
./build-venv/bin/python tests/test_engine_live.py    # all 38 languages end to end
./build-venv/bin/python tests/test_gui_live.py       # UI behaviour
./build-venv/bin/python tests/test_lang_picker.py
./build-venv/bin/python tests/test_sidebar.py
./build-venv/bin/python tests/test_target_selection.py
```

The live tests need a display; they exercise the real model rather than mocks.

## Licence

Application code is released under the MIT Licence — see [LICENSE](LICENSE).

The bundled model is **not** covered by that licence. Hunyuan-MT-7B is released by
Tencent under the [Tencent Hunyuan Community Licence](https://huggingface.co/tencent/Hunyuan-MT-7B),
which permits commercial use with conditions. Review it before redistributing the
model or using it commercially.

llama.cpp is MIT licensed.

## Acknowledgements

- [Tencent Hunyuan](https://github.com/Tencent-Hunyuan/Hunyuan-MT) for the Hunyuan-MT-7B model
- [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) for the inference runtime
- [CustomTkinter](https://github.com/TomSchimansky/CustomTkinter) for the UI toolkit
- [flagcdn.com](https://flagcdn.com) for the country flags
