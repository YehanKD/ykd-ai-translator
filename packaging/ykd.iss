; Inno Setup script for the YKD AI Translator (Windows).
;
; Build:   iscc packaging\ykd.iss
; Requires the PyInstaller onedir output in dist\YKD_AI_Translator\ first
; (see build_windows.ps1).
;
; The model and the llama.cpp runtime are already inside the PyInstaller
; bundle, so this simply wraps dist\ into a single installer.

#define AppName        "YKD AI Translator"
#define AppVersion     "2.0.0"
#define AppPublisher   "YKD"
#define AppExeName     "YKD_AI_Translator.exe"

[Setup]
AppId={{8F3C1B42-5A7E-4C9D-9E21-7B6A4D2C8F10}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\YKD AI Translator
DefaultGroupName=YKD AI Translator
DisableProgramGroupPage=yes
OutputBaseFilename=YKD_AI_Translator_Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; The bundle carries a ~4.3 GB model, so the installer is large.
; Raise the disk-spanning threshold so Setup does not try to split it.
DiskSpanning=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Everything PyInstaller produced, including runtime\ and models\.
Source: "dist\YKD_AI_Translator\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
