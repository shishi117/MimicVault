param([string]$DistDir)

# MimicVault - 拡張機能の強制アンインストール (Windows)
# policies.json に一時的に Extensions.Uninstall を追加し、Firefox を -headless
# で一度起動して処理させることで、enterprise policy（force_installed）で入った
# 拡張機能を実際にプロファイルから削除させる（uninstall.bat から呼ばれる）。
# force_installed はポリシーが有効な間ロックし続けるだけで、policies.json を
# 消しても既にインストール済みの拡張機能を遡って削除してはくれないため。
#
# 処理後は policies.json を元の内容に戻す（他の企業ポリシーが同ファイルに
# 混在していても壊さないようにするため）。uninstall.bat 側の既存処理
# （policies.json 自体の削除判定）はこのスクリプトの後に続けて行われる。
#
# 重要: 一時ポリシーでは ExtensionSettings 側の対象ID（force_installed指定）を
# 必ず取り除く。残したまま Extensions.Uninstall だけ追加すると、Firefoxは
# 「アンインストールしろ」と「強制インストールし続けろ」を同時に受け取り、
# 継続的に強制される ExtensionSettings の force_installed が優先されて
# Uninstall アクションが相殺され、拡張機能が削除されない（実際に発生した
# 不具合）。
#
# 既知の簡略化: headless 起動後、固定で待ってから終了させる。Firefox が
# ポリシーを処理し終えるタイミングを確実に検知する手段がないための妥協
# （上限値: 12秒 + 正常終了への切り替え猶予2秒）。重い/遅い環境では間に合わず
# 失敗する可能性があり、その場合は about:addons からの手動削除に自然に
# フォールバックする（エラーにはならない）。アップグレードパス: 起動した
# Firefox プロセスを定期的に監視し、extensions.json から該当IDが消えたことを
# 検知してから終了させる方式に変更。

$ErrorActionPreference = 'SilentlyContinue'
$EXT_ID = 'mimicvault@local'

if ([string]::IsNullOrEmpty($DistDir)) {
    Write-Host '[WARN] DistDir が指定されていません。拡張機能の強制削除をスキップします。'
    exit 0
}

$scriptDir = $PSScriptRoot
$ffDir = & (Join-Path $scriptDir 'find-firefox.ps1')
if (-not $ffDir) {
    Write-Host '[WARN] Firefox が見つからないため拡張機能の強制削除をスキップします。'
    Write-Host '       about:addons から手動で削除してください。'
    exit 0
}
$firefoxExe = Join-Path $ffDir 'firefox.exe'
if (-not (Test-Path $firefoxExe)) {
    Write-Host '[WARN] firefox.exe が見つからないため拡張機能の強制削除をスキップします。'
    exit 0
}

$policyFile = Join-Path $DistDir 'policies.json'
$originalExisted = Test-Path $policyFile
$originalContent = $null
if ($originalExisted) {
    $originalContent = Get-Content -Raw $policyFile -ErrorAction SilentlyContinue
}

# 既存内容（他の企業ポリシーを含む可能性がある）を保持したまま
# Extensions.Uninstall だけ追加する。
try {
    if ($originalContent) { $json = $originalContent | ConvertFrom-Json } else { $json = [PSCustomObject]@{} }
} catch {
    Write-Host '[WARN] 既存の policies.json を解析できませんでした。拡張機能の強制削除をスキップします。'
    exit 0
}

if (-not $json.policies) {
    $json | Add-Member -NotePropertyName policies -NotePropertyValue ([PSCustomObject]@{}) -Force
}

# force_installed指定が残っているとUninstallアクションと相殺されるため、
# ExtensionSettings側の対象IDだけを一時的に取り除く（他のIDの設定は保持）。
if ($json.policies.ExtensionSettings -and ($json.policies.ExtensionSettings.PSObject.Properties.Name -contains $EXT_ID)) {
    $json.policies.ExtensionSettings.PSObject.Properties.Remove($EXT_ID)
}

if (-not $json.policies.Extensions) {
    $json.policies | Add-Member -NotePropertyName Extensions -NotePropertyValue ([PSCustomObject]@{}) -Force
}
if ($json.policies.Extensions.Uninstall) {
    if ($json.policies.Extensions.Uninstall -notcontains $EXT_ID) {
        $json.policies.Extensions.Uninstall = @($json.policies.Extensions.Uninstall) + $EXT_ID
    }
} else {
    $json.policies.Extensions | Add-Member -NotePropertyName Uninstall -NotePropertyValue @($EXT_ID) -Force
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$tempContent = $json | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($policyFile, $tempContent, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[OK] 一時ポリシーを配置: $policyFile"

Write-Host '[INFO] 拡張機能を削除するため Firefox を一時的に終了します...'
Stop-Process -Name firefox -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host '[INFO] Firefox をヘッドレスで起動し、ポリシーを適用させています...'
$proc = Start-Process -FilePath $firefoxExe -ArgumentList '-headless', '-no-remote' -PassThru -ErrorAction SilentlyContinue
if ($proc) {
    Start-Sleep -Seconds 12
    if (-not $proc.HasExited) {
        # まず正常終了を試みる（extensions.json等の書き込みを完了させる猶予）。
        Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host '[WARN] Firefox の起動に失敗しました。'
}

# 元の内容に戻す（他のポリシー設定を保持 / 元々無かったファイルなら削除）
if ($originalExisted) {
    [System.IO.File]::WriteAllText($policyFile, $originalContent, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[OK] policies.json を元の内容に復元しました: $policyFile"
} else {
    Remove-Item $policyFile -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] 一時ポリシーを削除しました: $policyFile"
}
