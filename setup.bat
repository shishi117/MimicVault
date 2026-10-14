@echo off
:: MimicVault - installs devDependencies (web-ext etc.) via npm install.
:: ASCII only, see deploy/install-policy.bat for why.
:: Usage: double-click, or run from cmd: setup.bat
cd /d "%~dp0"
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed. See the error above.
  pause
  exit /b 1
)
echo.
echo [OK] npm install complete.
call npx web-ext --version
pause
