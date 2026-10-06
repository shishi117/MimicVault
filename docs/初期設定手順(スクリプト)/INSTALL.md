# MimicVault 拡張機能 — 永続インストール手順書

Firefox の **enterprise policy**（`ExtensionSettings` → `force_installed`）を使い、未署名の
MimicVault 拡張機能を「企業ポリシーにより追加」として永続的に常駐させる手順です。
`web-ext run` の一時読み込みと違い、**Firefox を再起動しても消えません**。

---

## 1. 対応ブラウザ（重要）

| Firefox 版 | 永続インストール |
|---|---|
| **ESR** | ✅ 可（未署名を許可できる） |
| **Developer Edition** | ✅ 可（未署名を許可できる） |
| Release（通常版） | ❌ 不可（未署名 XPI を拒否） |

拡張 ID は `mimicvault@local`（未署名）。**Release 版では動作しません。**
ESR または Developer Edition を用意してください。

---

## 2. 前提

- **Node.js / npm** がインストール済み（XPI ビルドに `web-ext` を使用）
- リポジトリのルートで一度 `npm install` 済みであること

```bash
npm install
```

---

## 3. インストール実行

インストーラが以下を自動で行います。

1. `web-ext build` で XPI をビルド
2. XPI を安定パスへ配置
   - macOS / Linux: `~/.mimicvault/mimicvault.xpi`
   - Windows: `%APPDATA%\MimicVault\mimicvault.xpi`
3. `deploy/policies.json` のプレースホルダ `__XPI_PATH__` を実パスに置換し、
   Firefox の policies ディレクトリへ配置（永続追加 + プライベートウィンドウ許可）

### macOS / Linux

```bash
./deploy/install-policy.sh [<policies ディレクトリ>]
```

- 第1引数を省略すると配置先を自動選択します。
  - **Linux**: `/etc/firefox/policies`（システム全体。書き込みに **sudo** が必要な場合あり）
  - **macOS**: `/Applications/Firefox Developer Edition.app/Contents/Resources/distribution`
- 別の Firefox を使う場合は第1引数でディレクトリを指定します。

```bash
# 例: 自分のプロファイル用 distribution に配置
./deploy/install-policy.sh ~/firefox-deved/distribution
```

### Windows

```bat
:: 省略可（Developer Edition の既定パスを使用）
deploy\install-policy.bat

:: 別の Firefox を使う場合は実パスを指定（角括弧・山括弧は付けない）
deploy\install-policy.bat "C:\Program Files\Firefox Developer Edition\distribution"
```

- 第1引数を省略すると `C:\Program Files\Firefox Developer Edition\distribution` を既定にします。
- policies.json の書き込みに**管理者権限が必要な場合があります**。

---

## 4. 未署名 XPI を許可する（一度きりの手動設定）

ESR / Developer Edition で未署名拡張を有効にするため、`about:config` で次を設定します。

```
xpinstall.signatures.required  →  false
```

> この pref はセキュリティ設定のため policy では配布せず、手動設定が必要です。

---

## 5. 反映と確認

1. **Firefox を再起動**します。
2. `about:addons` に MimicVault が **「企業ポリシーにより追加」** として表示されれば成功です。
3. `about:policies` でも配置内容を確認できます。

---

## 6. 配布される設定内容

`deploy/policies.json`（配置時に `__XPI_PATH__` が実パスに置換されます）:

```json
{
  "policies": {
    "ExtensionSettings": {
      "mimicvault@local": {
        "installation_mode": "force_installed",
        "install_url": "file://__XPI_PATH__"
      }
    },
    "Preferences": {
      "extensions.allowPrivateBrowsingByDefault": { "Value": true, "Status": "locked" }
    }
  }
}
```

- `force_installed`: 拡張を永続追加（ユーザーによる削除も禁止）
- `allowPrivateBrowsingByDefault=true`: プライベートウィンドウでの実行を全体許可
  （`webRequest` でメディア検出するために必要）

---

## 7. アップデート手順

拡張のコードを更新したら、**インストールと同じコマンドを再実行**するだけです。
新しい XPI が同じパスに上書き配置され、Firefox 再起動で反映されます。

```bash
# macOS / Linux
./deploy/install-policy.sh [<policies ディレクトリ>]

# Windows
deploy\install-policy.bat ["<Firefox>\distribution"]
```

---

## 8. アンインストール

1. 配置した `policies.json` を削除します（配置先はインストール時のログに表示されます）。
   - 例（Linux 既定）: `/etc/firefox/policies/policies.json`
   - 例（Windows 既定）: `C:\Program Files\Firefox Developer Edition\distribution\policies.json`
2. Firefox を再起動すると `about:addons` から MimicVault が消えます。
3. 配置済み XPI が不要なら削除します。
   - macOS / Linux: `~/.mimicvault/`
   - Windows: `%APPDATA%\MimicVault\`

> companion アプリ（Native Messaging / FFmpeg）のインストール・アンインストールは
> `docs/コンパニオンアプリ/README.md` を参照してください。拡張機能とは別管理です。

---

## 9. トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| `about:addons` に出ない | `about:policies` で policy が読まれているか確認。Firefox を完全再起動したか確認。 |
| 「署名されていないため無効」 | `xpinstall.signatures.required=false` が未設定。手順 4 を実施（ESR / Developer Edition のみ有効）。 |
| Release 版で入らない | 仕様。Release は未署名を拒否。ESR / Developer Edition を使用。 |
| `web-ext-artifacts/*.zip が見つかりません` | ビルド失敗。ルートで `npm install` 後、`npm run build` が通るか確認。 |
| policies.json を書き込めない | 配置先が権限不足。Linux は `sudo`、Windows は管理者権限で実行、またはプロファイル用 `distribution` を第1引数で指定。 |
| プライベートウィンドウで検出しない | policy 未反映。再起動後、`about:addons` →「プライベートウィンドウでの実行を許可する」を手動確認。 |
