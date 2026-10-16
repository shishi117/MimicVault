@echo off
:: MimicVault companion app - build script (Windows)
:: Compiles ..\companion\app.js into a single mimic-vault.exe (no Node.js
:: needed to run it). Output goes into ..\companion\ alongside the other
:: companion files.
::
:: Prerequisite: Bun installed (only on the build machine, not on the target).
::   https://bun.sh/  ->  powershell -c "irm bun.sh/install.ps1 | iex"
::
:: Run: double-click build.bat here, or run it from cmd.

setlocal
set "COMPANION_DIR=%~dp0..\companion"

where bun >nul 2>nul
if errorlevel 1 (
  echo [ERROR] bun not found. Install it from https://bun.sh/
  pause
  exit /b 1
)

echo === Building mimic-vault.exe ===
bun build "%COMPANION_DIR%\app.js" --compile --target=bun-windows-x64 --outfile "%COMPANION_DIR%\mimic-vault.exe"
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo [OK] mimic-vault.exe created in companion\.
echo.
echo Next steps:
echo   1. Put ffmpeg.exe in companion\ (for a zero-dependency build; see ffmpeg_deploy.bat)
echo   2. Run install.bat to register with Firefox
echo.

REM pause
