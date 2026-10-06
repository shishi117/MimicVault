# companion アプリ — exe版 初期設定手順

exe版（他人に配布）は `app.js` を単一 exe にコンパイルし、`ffmpeg.exe` を同梱します。**利用者に Node.js も FFmpeg も不要**です。
（companion アプリ自体の仕様は [コンパニオンアプリ/README.md](../コンパニオンアプリ/README.md) 参照）

## 1. exe をビルドする（ビルドする人だけ Bun が必要）

[Bun](https://bun.sh/) を入れて、`companion/` フォルダで:

```
build.bat
```

（中身は `bun build .\app.js --compile --target=bun-windows-x64 --outfile mimic-vault.exe` の1行です。他OSからのクロスビルドも同じコマンドで可能。Bun を使いたくない場合は Node.js 公式の SEA でも作れますが手順は増えます。）

## 2. ffmpeg.exe を同梱する

FFmpeg の Windows 用 static ビルド（例: gyan.dev / BtbN のリリース）から `ffmpeg.exe` を取得し、`mimic-vault.exe` と**同じフォルダ**に置きます。companion は同フォルダの `ffmpeg.exe` を自動で見つけます（無ければ PATH 上の ffmpeg にフォールバック）。

## 3. 配布・インストール

`mimic-vault.exe` / `ffmpeg.exe` / `native-manifest.json` / `install.bat` を1フォルダにまとめて配布します。利用者は `install.bat` を実行するだけ（管理者権限不要、`HKCU` に登録）。

> 配布時の注意: 署名なし exe は Windows SmartScreen の警告が出ることがあり、コンパイル済み JS の exe はまれにウイルス対策ソフトに誤検知されます。広く配るなら **コード署名証明書**の利用を検討してください。
