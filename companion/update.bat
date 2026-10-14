@echo off

setlocal
cd /d "%~dp0"

taskkill /f /im firefox.exe

del /f /q "mimic-vault.exe"

call ffmpeg_deploy.bat
call build.bat
call install.bat

START "" "C:\Program Files\Firefox Developer Edition\firefox.exe"

pause