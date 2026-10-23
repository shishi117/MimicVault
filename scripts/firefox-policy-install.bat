@echo off
:: MimicVault Firefox policy installer (Windows) - thin ASCII launcher.
:: Japanese messages live in deploy\install-policy.ps1 (UTF-8 with BOM) so cmd
:: never parses multi-byte text (avoids CP932/UTF-8 mojibake). Do NOT add
:: non-ASCII here.
:: Usage: firefox-policy-install.bat ["<Firefox>\distribution"]
::   Omit the arg to auto-detect the installed Firefox's distribution dir
::   (falls back to the Developer Edition default path if detection fails).
:: MIMICVAULT_CHAINED (set by install.bat) skips the final pause, since
:: install.bat's own window stays open regardless.
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\deploy\install-policy.ps1" -DistDir "%~1"
if not defined MIMICVAULT_CHAINED pause
