@echo off
:: MimicVault - Windows uninstaller.
:: Reverses what install.bat (via companion-install.bat + firefox-policy-install.bat)
:: set up on the system. Does NOT touch anything inside this repo (companion\*.exe etc.);
:: it only removes the registry key / files those scripts placed outside it:
::   1. Companion app Native Messaging host (registry key + manifest under %APPDATA%)
::   2. Firefox enterprise policy (policies.json) + the XPI copy under %APPDATA%\MimicVault
:: ASCII only, see firefox-policy-install.bat for why.
:: No parentheses inside any echo text below: a literal ( or ) in a message, even
:: balanced, can be misread as block syntax by cmd when it sits inside an if/else
:: block and makes the whole script abort before reaching the final "pause"
:: (window flashes and closes). Uses goto/labels instead of nested if/else blocks
:: for the same reason (see ffmpeg_deploy.bat for the same style).
:: Usage: double-click, or run from cmd: uninstaller.bat ["<Firefox>\distribution"]
::   Omit the arg to use the Firefox Developer Edition default distribution dir.

:: Self-elevate: policies.json normally lives under Program Files, which needs
:: administrator rights to delete. Same approach as install.bat.
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
set "DIST_DIR=%~1"
if "%DIST_DIR%"=="" set "DIST_DIR=C:\Program Files\Firefox Developer Edition\distribution"
set "POLICY_FILE=%DIST_DIR%\policies.json"

echo === MimicVault uninstaller Windows ===

echo.
echo === [1/2] Companion app Native Messaging host ===
reg delete "HKCU\Software\Mozilla\NativeMessagingHosts\mimic_vault" /f >nul 2>nul
if errorlevel 1 echo [INFO] Registry key not found, nothing to remove.
if not errorlevel 1 echo [OK] Registry key removed: HKCU\Software\Mozilla\NativeMessagingHosts\mimic_vault

if not exist "%APPDATA%\mimic_vault" goto skip_manifest
rd /s /q "%APPDATA%\mimic_vault"
echo [OK] Manifest folder removed: %APPDATA%\mimic_vault
goto manifest_done
:skip_manifest
echo [INFO] Manifest folder not found: %APPDATA%\mimic_vault
:manifest_done

echo.
echo === [2/2] Firefox extension policy ===
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

if not exist "%APPDATA%\MimicVault" goto skip_xpi
rd /s /q "%APPDATA%\MimicVault"
echo [OK] XPI folder removed: %APPDATA%\MimicVault
goto xpi_done
:skip_xpi
echo [INFO] XPI folder not found: %APPDATA%\MimicVault
:xpi_done

echo.
echo === Done ===
echo Restart Firefox: MimicVault will disappear from about:addons.
pause
