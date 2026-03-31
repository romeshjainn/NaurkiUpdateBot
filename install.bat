@echo off
setlocal EnableDelayedExpansion
title Naukri Bot — Installer

echo.
echo  ╔══════════════════════════════════════╗
echo  ║     Naukri Bot — Install             ║
echo  ╚══════════════════════════════════════╝
echo.

set "DEST=%LOCALAPPDATA%\NaukriBot"
set "BAT=%DEST%\run.bat"
set "SHORTCUT=%USERPROFILE%\Desktop\Naukri Bot.lnk"

:: ── Copy project to AppData ───────────────────────────────────────────────────
echo  [1/3] Installing to %DEST% ...
if exist "%DEST%" (
    echo        Removing old installation...
    rd /s /q "%DEST%"
)
xcopy /e /i /q /y "%~dp0." "%DEST%" >nul
echo        Done.

:: ── Create desktop shortcut via PowerShell ────────────────────────────────────
echo  [2/3] Creating desktop shortcut...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $s  = $ws.CreateShortcut('%SHORTCUT%'); ^
   $s.TargetPath     = '%BAT%'; ^
   $s.WorkingDirectory = '%DEST%'; ^
   $s.WindowStyle    = 1; ^
   $s.Description    = 'Run Naukri Bot'; ^
   $s.IconLocation   = 'shell32.dll,277'; ^
   $s.Save()"
echo        Shortcut created at Desktop.

:: ── Done ──────────────────────────────────────────────────────────────────────
echo  [3/3] Cleaning up...
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  Install complete!                   ║
echo  ║                                      ║
echo  ║  You can now:                        ║
echo  ║   • Delete this source folder        ║
echo  ║   • Double-click "Naukri Bot" on     ║
echo  ║     your desktop to run              ║
echo  ╚══════════════════════════════════════╝
echo.
pause
