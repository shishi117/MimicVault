@echo off
:: MimicVault Firefox policy installer (Windows) - thin ASCII launcher.
:: Japanese messages live in deploy\install-policy.ps1 (UTF-8 with BOM) so cmd
:: never parses multi-byte text (avoids CP932/UTF-8 mojibake). Do NOT add
:: non-ASCII here.
:: Usage: install-policy.bat ["<Firefox>\distribution"]
::   Omit the arg to use the Firefox Developer Edition default distribution dir.
:: MIMICVAULT_CHAINED (set by install-all.bat) skips the final pause, since
:: install-all.bat's own window stays open regardless.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\deploy\install-policy.ps1" -DistDir "%~1"
if not defined MIMICVAULT_CHAINED pause
