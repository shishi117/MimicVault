# MimicVault

ページ内の動画URL（HLS / DASH / 通常ファイル）を検出してダウンロードする Firefox 拡張機能。
HLS→MP4 変換などは Native Messaging 経由の companion アプリが担当します（`companion/README.md` 参照）。

## 拡張機能のインストール

対象は **Firefox ESR / Developer Edition**。この拡張は未署名（ID `mimicvault@local`）のため、
通常版（Release）Firefox は永続インストールを拒否します。

### 前提（一度きり）
未署名 XPI を許可するため、ESR / Developer Edition の `about:config` で
`xpinstall.signatures.required` を `false` に設定してください。

### 開発ループ（一時読み込み・自動リロード）
```bash
npm install
npm run lint          # web-ext lint
npm run run -- --firefox=deved   # Developer Edition を一時プロファイルで起動
```
`web-ext run` は Firefox 終了で消えます（永続インストールではありません）。
プライベートウィンドウ許可 pref は `web-ext-config.mjs` で自動付与されます。

### 永続インストール（enterprise policy で自動追加）
`web-ext build` した XPI を、Firefox の `policies.json`（`ExtensionSettings` →
`force_installed`）で永続的に自動追加します。プライベートウィンドウ許可も同時に配布されます。

```bash
# macOS / Linux
./deploy/install-policy.sh [<Firefox>/distribution]

# Windows
deploy\install-policy.bat ["<Firefox>\distribution"]
```
配置後 Firefox を再起動すると、`about:addons` に「企業ポリシーにより追加」として常駐します
（`about:policies` で確認可能）。ポリシーの雛形は `deploy/policies.json`。

## プライベートモード
`webRequest` でメディアを検出する都合上、プライベートウィンドウでは拡張の許可が必要です。
上記 policy で `extensions.allowPrivateBrowsingByDefault=true` を配布して全体許可しています。
手動で切り替える場合は `about:addons` → MimicVault →「プライベートウィンドウでの実行を許可する」。
