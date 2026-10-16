@echo off
:: MimicVault - runs the full setup chain, calling each script in this folder
:: in turn (no logic is merged; this just orchestrates them):
::   1. setup.bat          - prerequisite tools (Node.js/npm, Bun) + npm install
::   2. update.bat         - build/install the companion app (exe)
::   3. install-policy.bat - persist the extension via enterprise policy
:: ASCII only, see install-policy.bat for why.
:: Known limitation: steps 2 and 3 always "pause" at the end and do not reliably
:: report failure via errorlevel (see their own [ERROR] output if something
:: looks wrong); only step 1 (setup.bat) is checked here.
:: Usage: double-click, or run from cmd: install-all.bat ["<Firefox>\distribution"]

:: Self-elevate: install-policy.bat writes under Program Files, which needs
:: administrator rights. If not already elevated, relaunch this same script
:: via a UAC prompt and quit this (non-elevated) instance.
:: Known limitation: if "<Firefox>\distribution" contains spaces, the relaunch
:: below may not forward it correctly; in that case open an elevated command
:: prompt yourself and run install-all.bat "<path>" from there.
net session >nul 2>&1
if errorlevel 1 (
  echo [INFO] Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

setlocal
set "HERE=%~dp0"
set "MIMICVAULT_CHAINED=1"

echo === [1/3] setup.bat (prerequisite tools) ===
call "%HERE%setup.bat"
set "RC=%errorlevel%"
if "%RC%"=="2" (
  echo.
  echo [INFO] setup.bat installed a new tool and needs a fresh terminal.
  echo        Close this terminal, open a new one, and re-run install-all.bat.
  exit /b 2
)
if not "%RC%"=="0" (
  echo [ERROR] setup.bat failed. Stopping.
  exit /b 1
)

echo.
echo === [2/3] update.bat (companion app build/install) ===
call "%HERE%update.bat"

echo.
echo === [3/3] install-policy.bat (extension persistence) ===
call "%HERE%install-policy.bat" %1

echo.
echo === All steps done ===
pause
