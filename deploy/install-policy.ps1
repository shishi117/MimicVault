param([string]$DistDir)

# MimicVault 拡張機能 policy インストーラ本体（Windows）。
# 前提: ESR / Developer Edition（Release版は未署名を拒否）。node/npm 済み。
# このファイルは UTF-8 (BOM 付き) で保存すること。BOM が無いと Windows
# PowerShell 5.1 が ANSI として読み、日本語が文字化けする。

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $scriptDir

if ([string]::IsNullOrEmpty($DistDir)) {
    $ffDir = & (Join-Path $scriptDir 'find-firefox.ps1')
    if ($ffDir) {
        $DistDir = Join-Path $ffDir 'distribution'
        Write-Host "[OK] Firefox インストール先を自動検出: $ffDir"
    } else {
        $DistDir = 'C:\Program Files\Firefox Developer Edition\distribution'
        Write-Host '[WARN] Firefox インストール先を自動検出できませんでした。既定パスにフォールバックします。'
        Write-Host '       異なる場合は第1引数で distribution フォルダのパスを指定してください。'
    }
}
$xpiDir = Join-Path $env:APPDATA 'MimicVault'
$xpiPath = Join-Path $xpiDir 'mimicvault.xpi'
$dest = Join-Path $DistDir 'policies.json'

Write-Host '=== MimicVault 拡張機能 policy インストーラ (Windows) ==='

# 既に永続化登録済みの場合、古い policies.json / XPI を先に削除してから作り直す
# （二重登録や古い設定の残留を防ぐ）。
if (Test-Path $dest) {
    $existing = Get-Content -Raw $dest -ErrorAction SilentlyContinue
    if ($existing -match 'mimicvault@local') {
        Remove-Item $dest -Force
        Write-Host "[OK] 既存の永続化設定を削除: $dest"
    }
}
if (Test-Path $xpiPath) {
    Remove-Item $xpiPath -Force
    Write-Host "[OK] 既存の XPI を削除: $xpiPath"
}

Push-Location $repoRoot
& npm run --silent build
Pop-Location

$zip = Get-ChildItem (Join-Path $repoRoot 'web-ext-artifacts\*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { Write-Host '[ERROR] web-ext-artifacts\*.zip が見つかりません。'; exit 1 }

New-Item -ItemType Directory -Force -Path $xpiDir | Out-Null
Copy-Item $zip.FullName $xpiPath -Force
Write-Host "[OK] XPI 配置: $xpiPath"

$fileUrlPath = '/' + ($xpiPath -replace '\\','/')
$template = Join-Path $scriptDir 'policies.json'
$content = (Get-Content -Raw $template) -replace '__XPI_PATH__', $fileUrlPath

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
[System.IO.File]::WriteAllText($dest, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[OK] policies.json 配置: $dest"

Write-Host ''
Write-Host '=== 完了 ==='
Write-Host '▼ 未署名 XPI を有効にする一度きりの手動設定（ESR / Developer Edition のみ）:'
Write-Host '   about:config → xpinstall.signatures.required を false に設定'
Write-Host 'その後 Firefox を再起動すると about:addons に MimicVault が常駐します。'
