# Build the YKD AI Translator for Windows (PyInstaller onedir).
#
# Run this ON WINDOWS in PowerShell. PyInstaller cannot cross-build a working
# Windows bundle from Linux.
#
# Prerequisites:
#   py -m venv build-venv
#   .\build-venv\Scripts\pip install pyinstaller customtkinter pillow requests pytest
#   runtime\windows\  populated from llama-b11046-bin-win-cuda-12.4-x64.zip
#                     + cudart-llama-b11046-bin-win-cuda-12.4-x64.zip
#   models\Hy-MT2-7B-Q4_K_M.gguf

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$AppName = "YKD_AI_Translator"
$Py = ".\build-venv\Scripts\python.exe"

Write-Host "==> checking prerequisites"
if (-not (Test-Path $Py))                          { throw "$Py missing. Create the venv first." }
if (-not (Test-Path "runtime\windows"))            { throw "runtime\windows missing." }
if (-not (Test-Path "runtime\windows\llama-server.exe")) { throw "runtime\windows\llama-server.exe missing." }
if (-not (Test-Path "models\Hy-MT2-7B-Q4_K_M.gguf"))     { throw "model missing in models\." }

Write-Host "==> ensuring dependencies"
& $Py -m pip install -q --upgrade pyinstaller customtkinter pillow requests pytest

Write-Host "==> cleaning previous build"
Remove-Item -Recurse -Force build, dist, "$AppName.spec" -ErrorAction SilentlyContinue

Write-Host "==> running tests"
& $Py -m pytest tests\ -q

Write-Host "==> pyinstaller"
# NOTE: --add-data uses ';' as the separator on Windows, ':' on Linux.
& $Py -m PyInstaller `
  --noconfirm --windowed --name $AppName `
  --add-data "runtime;runtime" `
  --add-data "models;models" `
  --add-data "ykd/assets;ykd/assets" `
  --hidden-import customtkinter `
  --hidden-import PIL `
  --hidden-import PIL._tkinter_finder `
  --hidden-import requests `
  translator.py

Write-Host ""
Write-Host "==> DONE: dist\$AppName\$AppName.exe"
Get-ChildItem "dist\$AppName" | Select-Object Name, Length

Write-Host ""
Write-Host "Package it into a single installer with Inno Setup:"
Write-Host "  iscc packaging\ykd.iss"
Write-Host ""
Write-Host "Verify on a real Windows box: launch the exe, wait for 'Local Model Ready',"
Write-Host "then translate something. A successful build says nothing about runtime."
