@echo off
:: MimicVault companion app - rebuild + reinstall (Windows)
:: Kills Firefox, rebuilds mimic-vault.exe from ..\companion\app.js, re-registers
:: it with Firefox (pointing at ..\companion\), then relaunches Firefox.
setlocal
set "COMPANION_DIR=%~dp0..\companion"

taskkill /f /im firefox.exe

del /f /q "%COMPANION_DIR%\mimic-vault.exe"

call "%~dp0ffmpeg_deploy.bat"
call "%~dp0build.bat"
call "%~dp0install.bat" "%COMPANION_DIR%"

START "" "C:\Program Files\Firefox Developer Edition\firefox.exe"

pause
