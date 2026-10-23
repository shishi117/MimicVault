# MimicVault - Firefox インストール先自動検出 (Windows)
# companion-setup.bat（再起動用）と firefox-policy-install.bat / uninstall.bat
# （distribution フォルダの既定値用）で共有するヘルパー。
# firefox.exe を含むインストールディレクトリを標準出力に1行で返す。
# 見つからない場合は何も出力せず終了コード1で終わる。
# このファイルは UTF-8 (BOM 付き) で保存すること（install-policy.ps1 と同じ理由）。
$ErrorActionPreference = 'SilentlyContinue'

function Test-FirefoxExe([string]$Dir) {
    return $Dir -and (Test-Path (Join-Path $Dir 'firefox.exe'))
}

# 1) App Paths レジストリ: 公式インストーラーがエディション（Release/ESR/Developer Edition）
#    問わず登録する実行パス。最有力の検出手段。
foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
                   'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe') {
    $item = Get-Item -Path $root -ErrorAction SilentlyContinue
    if ($item) {
        $exePath = $item.GetValue('')
        if ($exePath -and (Test-Path $exePath)) {
            Write-Output (Split-Path -Parent $exePath)
            exit 0
        }
    }
}

# 2) Mozilla 製品別レジストリキー（App Paths が無い古い/一部環境向けの補助手段）
foreach ($product in 'Firefox Developer Edition', 'Mozilla Firefox ESR', 'Mozilla Firefox') {
    foreach ($root in 'HKLM:\SOFTWARE\Mozilla', 'HKLM:\SOFTWARE\WOW6432Node\Mozilla') {
        $productKey = Join-Path $root $product
        $ver = (Get-ItemProperty -Path $productKey -Name CurrentVersion -ErrorAction SilentlyContinue).CurrentVersion
        if ($ver) {
            $mainKey = Join-Path $productKey "$ver\Main"
            $dir = (Get-ItemProperty -Path $mainKey -Name 'Install Directory' -ErrorAction SilentlyContinue).'Install Directory'
            if (Test-FirefoxExe $dir) {
                Write-Output $dir
                exit 0
            }
        }
    }
}

# 3) よくあるデフォルトパス（レジストリ検出が失敗した場合の最終フォールバック）
foreach ($dir in 'C:\Program Files\Firefox Developer Edition',
                  'C:\Program Files\Mozilla Firefox',
                  'C:\Program Files (x86)\Mozilla Firefox',
                  'C:\Program Files (x86)\Firefox Developer Edition') {
    if (Test-FirefoxExe $dir) {
        Write-Output $dir
        exit 0
    }
}

exit 1
