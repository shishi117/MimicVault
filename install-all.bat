@echo off
:: MimicVault - runs the full setup chain, calling each existing script in turn
:: (no logic is merged; this just orchestrates them):
::   1. setup.bat               - prerequisite tools (Node.js/npm, Bun) + npm install
::   2. companion\update.bat    - build/install the companion app (exe)
::   3. deploy\install-policy.bat - persist the extension via enterprise policy
:: ASCII only, see deploy/install-policy.bat for why.
:: Known limitation: steps 2 and 3 always "pause" at the end and do not reliably
:: report failure via errorlevel (see their own [[ERROR]] output if something
:: looks wrong); only step 1 (setup.bat) is checked here.
:: Usage: double-click, or run from cmd: install-all.bat ["<Firefox>\distribution"]
setlocal
set "ROOT=%~dp0"

echo === [1/3] setup.bat (prerequisite tools) ===
call "%ROOT%setup.bat"
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
echo === [2/3] companion\update.bat (companion app build/install) ===
call "%ROOT%companion\update.bat"

echo.
echo === [3/3] deploy\install-policy.bat (extension persistence) ===
call "%ROOT%deploy\install-policy.bat" %1

echo.
echo === All steps done ===
pause
