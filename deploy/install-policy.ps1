param([string]$DistDir)

# MimicVault 拡張機能 policy インストーラ本体（Windows）。
# 前提: ESR / Developer Edition（Release版は未署名を拒否）。node/npm 済み。
# このファイルは UTF-8 (BOM 付き) で保存すること。BOM が無いと Windows
# PowerShell 5.1 が ANSI として読み、日本語が文字化けする。

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $scriptDir

Write-Host '=== MimicVault 拡張機能 policy インストーラ (Windows) ==='
Push-Location $repoRoot
& npm run --silent build
Pop-Location

$zip = Get-ChildItem (Join-Path $repoRoot 'web-ext-artifacts\*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { Write-Host '[ERROR] web-ext-artifacts\*.zip が見つかりません。'; exit 1 }

$xpiDir = Join-Path $env:APPDATA 'MimicVault'
New-Item -ItemType Directory -Force -Path $xpiDir | Out-Null
$xpiPath = Join-Path $xpiDir 'mimicvault.xpi'
Copy-Item $zip.FullName $xpiPath -Force
Write-Host "[OK] XPI 配置: $xpiPath"

$fileUrlPath = '/' + ($xpiPath -replace '\\','/')
$template = Join-Path $scriptDir 'policies.json'
$content = (Get-Content -Raw $template) -replace '__XPI_PATH__', $fileUrlPath

if ([string]::IsNullOrEmpty($DistDir)) { $DistDir = 'C:\Program Files\Firefox Developer Edition\distribution' }
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$dest = Join-Path $DistDir 'policies.json'
[System.IO.File]::WriteAllText($dest, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[OK] policies.json 配置: $dest"

Write-Host ''
Write-Host '=== 完了 ==='
Write-Host '▼ 未署名 XPI を有効にする一度きりの手動設定（ESR / Developer Edition のみ）:'
Write-Host '   about:config → xpinstall.signatures.required を false に設定'
Write-Host 'その後 Firefox を再起動すると about:addons に MimicVault が常駐します。'
