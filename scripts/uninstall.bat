@echo off
:: MimicVault - Windows uninstaller.
:: Reverses what install.bat (via companion-install.bat + firefox-policy-install.bat)
:: set up on the system. Does NOT touch anything inside this repo (companion\*.exe etc.);
:: it only removes the registry key / files those scripts placed outside it:
::   1. Companion app Native Messaging host (registry key + manifest under %APPDATA%)
::   2. Firefox enterprise policy (policies.json) + the XPI copy under %APPDATA%\MimicVault
:: Also force-removes the extension itself from the Firefox profile (not just the
:: policy lock): deploy\force-uninstall-extension.ps1 briefly launches Firefox
:: headless with a temporary Extensions.Uninstall policy so it actually leaves
:: about:addons instead of lingering as a normal, removable add-on.
:: ASCII only, see firefox-policy-install.bat for why.
:: No parentheses inside any echo text below: a literal ( or ) in a message, even
:: balanced, can be misread as block syntax by cmd when it sits inside an if/else
:: block and makes the whole script abort before reaching the final "pause"
:: (window flashes and closes). Uses goto/labels instead of nested if/else blocks
:: for the same reason (see ffmpeg_deploy.bat for the same style).
:: Usage: double-click, or run from cmd: uninstaller.bat ["<Firefox>\distribution"]
::   Omit the arg to auto-detect the installed Firefox's distribution dir
::   (falls back to the Developer Edition default path if detection fails).

:: Self-elevate: policies.json normally lives under Program Files, which needs
:: administrator rights to delete. Same approach as install.bat, including the
:: same gotcha: approving UAC with a *different* administrator account's
:: credentials switches %APPDATA%/HKCU to that admin's, not ours, so the
:: companion app's manifest/registry key and the XPI copy would be looked up
:: in the wrong place. Forward our own identity across the elevation the same
:: way install.bat does.
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

set "DIST_DIR=%~1"
if "%DIST_DIR%"=="_" set "DIST_DIR="
if not "%DIST_DIR%"=="" goto dist_dir_set
set "FIREFOX_DIR="
for /f "delims=" %%D in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\deploy\find-firefox.ps1" 2^>nul') do set "FIREFOX_DIR=%%D"
if defined FIREFOX_DIR goto dist_dir_detected
set "DIST_DIR=C:\Program Files\Firefox Developer Edition\distribution"
goto dist_dir_set
:dist_dir_detected
set "DIST_DIR=%FIREFOX_DIR%\distribution"
:dist_dir_set
set "POLICY_FILE=%DIST_DIR%\policies.json"

echo === MimicVault uninstaller Windows ===

echo.
echo === [1/2] Companion app Native Messaging host ===
reg delete "HKU\%MIMICVAULT_ORIG_SID%\Software\Mozilla\NativeMessagingHosts\mimic_vault" /f >nul 2>nul
if errorlevel 1 echo [INFO] Registry key not found, nothing to remove.
if not errorlevel 1 echo [OK] Registry key removed: HKU\%MIMICVAULT_ORIG_SID%\Software\Mozilla\NativeMessagingHosts\mimic_vault

if not exist "%MIMICVAULT_ORIG_APPDATA%\mimic_vault" goto skip_manifest
rd /s /q "%MIMICVAULT_ORIG_APPDATA%\mimic_vault"
echo [OK] Manifest folder removed: %MIMICVAULT_ORIG_APPDATA%\mimic_vault
goto manifest_done
:skip_manifest
echo [INFO] Manifest folder not found: %MIMICVAULT_ORIG_APPDATA%\mimic_vault
:manifest_done

echo.
echo === [2/2] Firefox extension policy ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\deploy\force-uninstall-extension.ps1" -DistDir "%DIST_DIR%"
if not exist "%POLICY_FILE%" goto policy_missing
findstr /c:"mimicvault@local" "%POLICY_FILE%" >nul 2>nul
if errorlevel 1 goto policy_unrelated
del /f /q "%POLICY_FILE%"
echo [OK] Policy removed: %POLICY_FILE%
goto policy_done
:policy_unrelated
echo [INFO] Policy file exists but does not reference MimicVault, leaving it as is.
goto policy_done
:policy_missing
echo [INFO] Policy file not found: %POLICY_FILE%
:policy_done

if not exist "%MIMICVAULT_ORIG_APPDATA%\MimicVault" goto skip_xpi
rd /s /q "%MIMICVAULT_ORIG_APPDATA%\MimicVault"
echo [OK] XPI folder removed: %MIMICVAULT_ORIG_APPDATA%\MimicVault
goto xpi_done
:skip_xpi
echo [INFO] XPI folder not found: %MIMICVAULT_ORIG_APPDATA%\MimicVault
:xpi_done

echo.
echo === Done ===
echo MimicVault should already be gone from about:addons (step 2 above force-
echo removed it via a temporary Firefox headless run).
echo.
echo If it still appears after restarting Firefox, the headless removal step
echo likely did not finish in time, or Firefox/policies.json was not where
echo this script expected. In that case Firefox is no longer enforcing the
echo policy install, but it can leave the extension sitting in your profile
echo as a normal, removable add-on.
echo Remove it by hand: open about:addons, find MimicVault, click its menu
echo button, and choose Remove.
pause
