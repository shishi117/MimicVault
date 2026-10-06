# MimicVault 初期設定手順（exe版）

companion アプリの **exe版**（他人に配布する際、利用者側に Node.js も FFmpeg も不要にする版）を
ビルド・配布・インストールする手順です。拡張機能自体の永続インストールは
[初期設定手順(スクリプト).md](初期設定手順(スクリプト).md) を参照してください（exe版が対象にするのは
companion アプリのみで、拡張機能のインストール方法はスクリプト版と共通です）。

---

## 1. 前提ツールの導入（ビルドする人のみ）

exe を**ビルドする人**だけがこの章のツールを必要とします。ビルド済み exe を受け取って使うだけの利用者には
不要です（4章の配布物をそのまま使えます）。

### 1.1 Bun の導入

`app.js` を単一 exe にコンパイルするために使用します。

- **Windows**:
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
- **macOS / Linux**:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- インストーラーが PATH への追加を自動で行いますが、反映されない場合は新しいターミナルを開き直すか、
  表示されたメッセージに従って `~/.bashrc` 等を `source` してください。

**確認**

```bash
bun --version
```

> Bun を使いたくない場合は Node.js 公式の [SEA（Single Executable Applications）](https://nodejs.org/api/single-executable-applications.html)
> でも同様の exe を作成できますが、手順が増えます。

### 1.2 FFmpeg（同梱用バイナリ）の取得

exe 版は `ffmpeg.exe` を**同梱して配布**するため、ビルドする人のマシンに FFmpeg をインストールする必要は
ありません。配布物に含める `ffmpeg.exe` を次の手順で入手します。

1. FFmpeg の Windows 用 static ビルドを配布しているサイト（[gyan.dev](https://www.gyan.dev/ffmpeg/builds/) や
   [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases)）から `release full` 版の zip を
   ダウンロードします。
2. zip を展開し、中の `bin\ffmpeg.exe` を取り出します。
3. この `ffmpeg.exe` を 3章で同梱用に使用します。

---

## 2. exe をビルドする

[Bun](https://bun.sh/) を入れて、`companion/` フォルダで:

```
build.bat
```

（中身は `bun build .\app.js --compile --target=bun-windows-x64 --outfile mimic-vault.exe` の1行です。他OSからの
クロスビルドも同じコマンドで可能です。）

---

## 3. ffmpeg.exe を同梱する

1.2 で取得した `ffmpeg.exe` を、`mimic-vault.exe` と**同じフォルダ**に置きます。companion は同フォルダの
`ffmpeg.exe` を自動で見つけます（無ければ PATH 上の ffmpeg にフォールバック）。

---

## 4. 配布・インストール

`mimic-vault.exe` / `ffmpeg.exe` / `native-manifest.json` / `install.bat` を1フォルダにまとめて配布します。
利用者は `install.bat` を実行するだけです（管理者権限不要、`HKCU` に登録）。

> 配布時の注意: 署名なし exe は Windows SmartScreen の警告が出ることがあり、コンパイル済み JS の exe は
> まれにウイルス対策ソフトに誤検知されます。広く配るなら **コード署名証明書**の利用を検討してください。

インストール後、Firefox を再起動すると拡張機能のポップアップ右上に companion 接続インジケータが表示されます。
companion アプリの仕様・アンインストール手順は [コンパニオンアプリ.md](コンパニオンアプリ.md) を参照してください。
