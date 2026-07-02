@echo off
:: MimicVault Firefox policy installer (Windows) - thin ASCII launcher.
:: Japanese messages live in install-policy.ps1 (UTF-8 with BOM) so cmd never
:: parses multi-byte text (avoids CP932/UTF-8 mojibake). Do NOT add non-ASCII here.
:: Usage: deploy\install-policy.bat ["<Firefox>\distribution"]
::   Omit the arg to use the Firefox Developer Edition default distribution dir.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-policy.ps1" -DistDir "%~1"
pause
