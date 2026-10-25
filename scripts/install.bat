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
::
:: Gotcha: if the UAC prompt is approved with a *different* administrator
:: account's credentials, the relaunched process runs as that admin, not as
:: this user - %APPDATA%/%USERPROFILE%/HKCU all silently become the admin's,
:: not ours. companion-install.bat and install-policy.ps1 write per-user data
:: (native messaging manifest, HKCU registry key, the XPI copy) using those
:: variables, so it would get written to the wrong account and the policy
:: that is applied to this account would point at a file only the admin
:: account can read - Firefox fails to install the extension. So capture our
:: own identity before elevating and forward it through as extra args; '_'
:: is a non-empty placeholder for "no distdir arg" (see the empty-string
:: gotcha above).
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value"`) do set "MIMICVAULT_PRE_SID=%%S"
net session >nul 2>&1
if errorlevel 1 (
  echo [INFO] Requesting administrator privileges...
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '_','%USERNAME%','%USERPROFILE%','%MIMICVAULT_PRE_SID%' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%~1','%USERNAME%','%USERPROFILE%','%MIMICVAULT_PRE_SID%' -Verb RunAs"
  )
  exit /b
)

setlocal
set "HERE=%~dp0"
set "MIMICVAULT_CHAINED=1"

:: %2/%3/%4 carry the pre-elevation identity when we relaunched ourselves
:: above; otherwise we were already running as an administrator (no account
:: switch happened), so we ARE the right user.
if not "%~2"=="" (
  set "MIMICVAULT_ORIG_USER=%~2"
  set "MIMICVAULT_ORIG_PROFILE=%~3"
  set "MIMICVAULT_ORIG_SID=%~4"
) else (
  set "MIMICVAULT_ORIG_USER=%USERNAME%"
  set "MIMICVAULT_ORIG_PROFILE=%USERPROFILE%"
  set "MIMICVAULT_ORIG_SID=%MIMICVAULT_PRE_SID%"
)
set "MIMICVAULT_ORIG_APPDATA=%MIMICVAULT_ORIG_PROFILE%\AppData\Roaming"
set "DISTDIR_ARG=%~1"
if "%DISTDIR_ARG%"=="_" set "DISTDIR_ARG="

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
call "%HERE%firefox-policy-install.bat" "%DISTDIR_ARG%"

echo.
echo === All steps done ===
START "" "C:\Program Files\Firefox Developer Edition\firefox.exe"
pause
