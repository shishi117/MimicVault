@echo off
:: MimicVault companion app - rebuild + reinstall (Windows)
:: Kills Firefox, rebuilds mimic-vault.exe from ..\companion\app.js, re-registers
:: it with Firefox (pointing at ..\companion\), then relaunches Firefox.
:: MIMICVAULT_CHAINED (set by install.bat) skips the final pause, since
:: install.bat's own window stays open regardless.
setlocal
set "COMPANION_DIR=%~dp0..\companion"

taskkill /f /im firefox.exe

del /f /q "%COMPANION_DIR%\mimic-vault.exe"

call "%~dp0ffmpeg_deploy.bat"
call "%~dp0companion-build.bat"
call "%~dp0companion-install.bat" "%COMPANION_DIR%"

set "FIREFOX_DIR="
for /f "delims=" %%D in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\deploy\find-firefox.ps1" 2^>nul') do set "FIREFOX_DIR=%%D"
if defined FIREFOX_DIR START "" "%FIREFOX_DIR%\firefox.exe"
if not defined FIREFOX_DIR echo [WARN] Firefox install not found automatically. Start it manually.

if not defined MIMICVAULT_CHAINED pause
