# companion アプリ — スクリプト版 初期設定手順

スクリプト版（開発・自分用）は `node app.js` を .bat/.sh ラッパー経由で実行します。利用者に Node.js が必要です。
（companion アプリ自体の仕様は [コンパニオンアプリ/README.md](../コンパニオンアプリ/README.md) 参照）

## 必要なソフトウェア

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
