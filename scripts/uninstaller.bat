@echo off
:: MimicVault - Windows uninstaller.
:: Reverses what install.bat (via companion-install.bat + firefox-policy-install.bat)
:: set up on the system. Does NOT touch anything inside this repo (companion\*.exe etc.);
:: it only removes the registry key / files those scripts placed outside it:
::   1. Companion app Native Messaging host (registry key + manifest under %APPDATA%)
::   2. Firefox enterprise policy (policies.json) + the XPI copy under %APPDATA%\MimicVault
:: ASCII only, see firefox-policy-install.bat for why.
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

echo === MimicVault uninstaller (Windows) ===

echo.
echo === [1/2] Companion app (Native Messaging host) ===
reg delete "HKCU\Software\Mozilla\NativeMessagingHosts\mimic_vault" /f >nul 2>nul
if errorlevel 1 (
  echo [INFO] Registry key not found (already removed, or never installed).
) else (
  echo [OK] Registry key removed: HKCU\Software\Mozilla\NativeMessagingHosts\mimic_vault
)
if exist "%APPDATA%\mimic_vault" (
  rd /s /q "%APPDATA%\mimic_vault"
  echo [OK] Manifest folder removed: %APPDATA%\mimic_vault
) else (
  echo [INFO] Manifest folder not found: %APPDATA%\mimic_vault
)

echo.
echo === [2/2] Firefox extension policy (enterprise policy) ===
set "POLICY_FILE=%DIST_DIR%\policies.json"
if exist "%POLICY_FILE%" (
  findstr /c:"mimicvault@local" "%POLICY_FILE%" >nul 2>nul
  if errorlevel 1 (
    echo [INFO] %POLICY_FILE% exists but does not reference MimicVault. Leaving it as is.
  ) else (
    del /f /q "%POLICY_FILE%"
    echo [OK] Policy removed: %POLICY_FILE%
  )
) else (
  echo [INFO] Policy file not found: %POLICY_FILE%
)
if exist "%APPDATA%\MimicVault" (
  rd /s /q "%APPDATA%\MimicVault"
  echo [OK] XPI folder removed: %APPDATA%\MimicVault
) else (
  echo [INFO] XPI folder not found: %APPDATA%\MimicVault
)

echo.
echo === Done ===
echo Restart Firefox: MimicVault will disappear from about:addons.
pause
