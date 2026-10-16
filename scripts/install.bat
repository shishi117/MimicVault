@echo off
:: MimicVault - runs the full setup chain, calling each script in this folder
:: in turn (no logic is merged; this just orchestrates them):
::   1. prerequisite-setup.bat   - prerequisite tools (Node.js/npm, Bun) + npm install
::   2. companion-setup.bat      - build/install the companion app (exe)
::   3. firefox-policy-install.bat - persist the extension via enterprise policy
:: ASCII only, see firefox-policy-install.bat for why.
:: Known limitation: steps 2 and 3 always "pause" at the end and do not reliably
:: report failure via errorlevel (see their own [ERROR] output if something
:: looks wrong); only step 1 (prerequisite-setup.bat) is checked here.
:: Usage: double-click, or run from cmd: install.bat ["<Firefox>\distribution"]

:: Self-elevate: firefox-policy-install.bat writes under Program Files, which
:: needs administrator rights. If not already elevated, relaunch this same
:: script via a UAC prompt and quit this (non-elevated) instance.
:: Start-Process -ArgumentList rejects an empty string, so the no-argument
:: case (the common one) must omit -ArgumentList entirely rather than pass ''.
net session >nul 2>&1
if errorlevel 1 (
  echo [INFO] Requesting administrator privileges...
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%~1' -Verb RunAs"
  )
  exit /b
)

setlocal
set "HERE=%~dp0"
set "MIMICVAULT_CHAINED=1"

echo === [1/3] prerequisite-setup.bat (prerequisite tools) ===
call "%HERE%prerequisite-setup.bat"
set "RC=%errorlevel%"
if "%RC%"=="2" (
  echo.
  echo [INFO] prerequisite-setup.bat installed a new tool and needs a fresh terminal.
  echo        Close this terminal, open a new one, and re-run install.bat.
  exit /b 2
)
if not "%RC%"=="0" (
  echo [ERROR] prerequisite-setup.bat failed. Stopping.
  exit /b 1
)

echo.
echo === [2/3] companion-setup.bat (companion app build/install) ===
call "%HERE%companion-setup.bat"

echo.
echo === [3/3] firefox-policy-install.bat (extension persistence) ===
call "%HERE%firefox-policy-install.bat" %1

echo.
echo === All steps done ===
pause
