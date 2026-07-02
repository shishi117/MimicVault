# MimicVault — Companion App

FFmpeg を使って HLS → MP4 変換（および DASH mux）を行うための Native Messaging companion app です。

> **旧 Media Snatcher からの移行**: Native Messaging ホスト名が `media_snatcher` → `mimic_vault` に変わりました。
> 以前 companion をインストールしている場合は、古いホスト登録を削除（下記「アンインストール」参照）してから
> `install.sh` / `install.bat` を再実行してください。再登録後は Firefox の再起動が必要です。

配布形態は2通りあります。

- **スクリプト版**（開発・自分用）: `node app.js` を .bat/.sh ラッパー経由で実行。利用者に Node.js が必要。
- **exe版**（他人に配布）: `app.js` を単一 exe にコンパイルし、`ffmpeg.exe` を同梱。**利用者に Node.js も FFmpeg も不要**。

---

## exe版のビルドと配布（依存ゼロ）

### 1. exe をビルドする（ビルドする人だけ Bun が必要）

[Bun](https://bun.sh/) を入れて、`companion/` フォルダで:

```
build.bat
```

（中身は `bun build .\app.js --compile --target=bun-windows-x64 --outfile mimic-vault.exe` の1行です。他OSからのクロスビルドも同じコマンドで可能。Bun を使いたくない場合は Node.js 公式の SEA でも作れますが手順は増えます。）

### 2. ffmpeg.exe を同梱する

FFmpeg の Windows 用 static ビルド（例: gyan.dev / BtbN のリリース）から `ffmpeg.exe` を取得し、`mimic-vault.exe` と**同じフォルダ**に置きます。companion は同フォルダの `ffmpeg.exe` を自動で見つけます（無ければ PATH 上の ffmpeg にフォールバック）。

### 3. 配布・インストール

`mimic-vault.exe` / `ffmpeg.exe` / `native-manifest.json` / `install.bat` を1フォルダにまとめて配布します。利用者は `install.bat` を実行するだけ（管理者権限不要、`HKCU` に登録）。

> 配布時の注意: 署名なし exe は Windows SmartScreen の警告が出ることがあり、コンパイル済み JS の exe はまれにウイルス対策ソフトに誤検知されます。広く配るなら **コード署名証明書**の利用を検討してください。

---

## スクリプト版（自分用）に必要なソフトウェア

| ソフトウェア | バージョン | 用途 |
|---|---|---|
| [Node.js](https://nodejs.org/) | v14 以上 | companion app の実行ランタイム |
| [FFmpeg](https://ffmpeg.org/download.html) | 4.0 以上 | 動画変換・mux |

どちらも `PATH` が通っている必要があります。

## インストール手順

### macOS

```bash
cd companion/
chmod +x install.sh mimic-vault
./install.sh
```

### Windows

`install.bat` をダブルクリック（または cmd.exe から実行）

管理者権限は**不要**です（レジストリは `HKCU` に書き込みます）。

## インストール後

Firefox を再起動すると、拡張機能のポップアップ右上に companion 接続インジケータ（`⚡`）が表示されます。

- `⚡` 緑: companion 接続済み — HLS ダウンロードは FFmpeg 経由で MP4 に変換されます
- `○` グレー: companion 未接続 — 従来通り `.ts` ファイルとして保存されます

## companion が行うこと

- HLS プレイリスト URL を受け取り、FFmpeg で MP4 に変換
- 変換済みファイルをユーザーの **Downloads フォルダ**に保存
- 変換進捗（0%〜100%）を拡張機能に通知

## companion が行わないこと

- ネットワーク外（インターネット以外）へのデータ送信
- 変換完了後のファイル以外のデータ保持

## アンインストール

### macOS

```bash
rm ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/mimic_vault.json
```

### Windows

```
reg delete "HKCU\Software\Mozilla\NativeMessagingHosts\mimic_vault" /f
del "%APPDATA%\mimic_vault\native-manifest.json"
```
