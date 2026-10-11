@echo off
:: MimicVault companion app - build script (Windows)
:: Compiles app.js into a single mimic-vault.exe (no Node.js needed to run it).
::
:: Prerequisite: Bun installed (only on the build machine, not on the target).
::   https://bun.sh/  ->  powershell -c "irm bun.sh/install.ps1 | iex"
::
:: Run: double-click build.bat in this folder, or run it from cmd.

setlocal
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo [ERROR] bun not found. Install it from https://bun.sh/
  pause
  exit /b 1
)

echo === Building mimic-vault.exe ===
bun build .\app.js --compile --target=bun-windows-x64 --outfile mimic-vault.exe
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo [OK] mimic-vault.exe created.
echo.
echo Next steps:
echo   1. Put ffmpeg.exe in this folder (for a zero-dependency build)
echo   2. Run install.bat to register with Firefox
echo.

REM pause
