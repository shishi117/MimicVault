@echo off
:: MimicVault - installs prerequisite tools (Node.js/npm, Bun) if missing, then
:: installs devDependencies (web-ext etc.) via npm install.
:: ASCII only, see firefox-policy-install.bat for why.
:: Known limitation: winget / the Bun installer update PATH for new terminals only,
:: not this already-running one. If either is installed below, this script stops
:: and asks you to re-run it from a fresh terminal.
:: MIMICVAULT_CHAINED (set by install.bat before calling this) skips every
:: "press a key" pause below, since install.bat's own window stays open
:: regardless. Run this script directly (not via install.bat) to keep them.
:: Usage: double-click, or run from cmd: prerequisite-setup.bat
setlocal
cd /d "%~dp0.."

set NEED_NEW_TERMINAL=0

echo === Checking Node.js / npm ===
where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Node.js not found and winget is unavailable.
    echo         Install Node.js manually: see docs\initial setup doc section 1.2
    if not defined MIMICVAULT_CHAINED pause
    exit /b 1
  )
  echo [INFO] Node.js not found. Installing via winget...
  winget install -e --id OpenJS.NodeJS.LTS
  if errorlevel 1 (
    echo [ERROR] winget install failed. Install Node.js manually from https://nodejs.org/
    if not defined MIMICVAULT_CHAINED pause
    exit /b 1
  )
  set NEED_NEW_TERMINAL=1
) else (
  echo [OK] Node.js found.
)

echo.
echo === Checking Bun ===
where bun >nul 2>nul
if errorlevel 1 (
  echo [INFO] Bun not found. Installing...
  powershell -NoProfile -Command "irm bun.sh/install.ps1 | iex"
  if errorlevel 1 (
    echo [ERROR] Bun install failed. Install manually from https://bun.sh/
    if not defined MIMICVAULT_CHAINED pause
    exit /b 1
  )
  set NEED_NEW_TERMINAL=1
) else (
  echo [OK] Bun found.
)

if "%NEED_NEW_TERMINAL%"=="1" (
  echo.
  echo [OK] Install step done. Close this terminal, open a new one, and re-run
  echo      prerequisite-setup.bat so the updated PATH takes effect.
  if not defined MIMICVAULT_CHAINED pause
  exit /b 2
)

echo.
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed. See the error above.
  if not defined MIMICVAULT_CHAINED pause
  exit /b 1
)
echo.
echo [OK] npm install complete.
call npx web-ext --version
if not defined MIMICVAULT_CHAINED pause
