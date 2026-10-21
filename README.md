# MimicVault

ブラウザの通信からメディアを検出してダウンロードする Firefox 拡張機能。
HLS→MP4 変換や mux などは Native Messaging 経由の companion アプリが担当します（`docs/コンパニオンアプリ.md` 参照）。
**拡張機能自体には動画をMP4に変換する機能は無いため、companion app が無いとMP4化できません**。
companion 未接続時は HLS/DASH 等はすべて生の `.ts`/断片化 `.mp4` のまま保存されます。

## 対応規格

| 規格 | 検出 | ダウンロード | 備考 |
|------|------|--------------|------|
| **HLS** (.m3u8) | ✅ | companion で MP4 変換 / 未接続時は結合 .ts。ライブは分割録画 | AES-128 復号対応、SAMPLE-AES 非対応 |
| **DASH** (.mpd) | ✅ | トラック選択 + companion で mux（映像+音声→MP4） | — |
| **MSS** (Smooth Streaming, .ism/Manifest) | ✅ | `.ism` を DASH(MPD) URL に解決して DASH 経路へ委譲 | 下記の制限あり |
| **収集ストリーム**（マニフェスト非露出の MSE） | ✅ | 収集した fMP4 断片を結合し companion で remux / 未接続時は断片化MP4 | 下記の制限あり |

対象は HTTP(S) で流れるメディアのみです。WebRTC / RTMP / RTSP は HTTP ではないため検出できません。

通常の mp4/webm 等の直リンク単体ファイル（ブラウザの標準DL機能で保存できるもの）は、
意図的に検出・一覧表示の対象外にしています。

### MSS（Smooth Streaming）の制限
動的パッケージャー（同じ `.ism` から DASH も配信する Unified Streaming / Azure / IIS / Wowza 等）に対応します。
`.ism/Manifest` を検出すると既知の DASH 記法（`.ism/.mpd`、`manifest(format=mpd-time-csf)`、`manifest.mpd`）を
順に試し、MPD を返す URL を使って既存の DASH 処理に委譲します。

どの記法も該当しない**静的 Smooth（断片のみで DASH 再パッケージ非対応）**は、`.ism/Manifest` の XML を
直接パースし、`CodecPrivateData` から fMP4 init セグメントを自前生成して DASH と同じダウンロード経路に
乗せます（`background/mssManifestParse.js` / `background/mssInitSegment.js`）。

- 対応コーデックは **映像 H.264(AVC1) + 音声 AAC系(AACL/AACH等)のみ**。HEVC/VC-1/WMA等は未対応として
  エラー表示されます。
- **PlayReady 等の暗号化（マニフェストの `Protection` 要素）は未対応**で、検出時に明示エラーを返します
  （HLSのSAMPLE-AESと同じ扱い）。

### 収集ストリーム（汎用 MSE）の制限
`.mpd`/`.m3u8` を露出しないプレイヤーが取得する fMP4 断片（`.m4s`/`.cmf*` + `init`）を、ディレクトリ単位で
1つのストリームに束ねて結合ダウンロードします。以下の制限があります。
- ユーザーが**再生し切った範囲**の断片しか集まりません（ライブ録画と同じ本質的制約）。
- 断片は元 URL を再取得するため、署名付き一時 URL は失効しうる。
- 1ディレクトリに複数レンディション/トラックが混在するレイアウトは v1 では分離しません
  （大半のパッケージャはレンディション別ディレクトリなので通常は正しく動作）。
- TS 断片・連番 .mp4・Smooth Fragments（init 不在）は対象外。

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

# Windows（拡張機能のみ。前提ツール導入や companion アプリも含めて一括で行う場合は
# scripts\install.bat を使用。詳細な手順は docs/初期設定手順.md 参照）
scripts\firefox-policy-install.bat ["<Firefox>\distribution"]
```
配置後 Firefox を再起動すると、`about:addons` に「企業ポリシーにより追加」として常駐します
（`about:policies` で確認可能）。ポリシーの雛形は `deploy/policies.json`。
アンインストールする場合は `scripts\uninstall.bat` を実行してください（companion のホスト登録も含めて削除）。

## プライベートモード
`webRequest` でメディアを検出する都合上、プライベートウィンドウでは拡張の許可が必要です。
上記 policy で `extensions.allowPrivateBrowsingByDefault=true` を配布して全体許可しています。
手動で切り替える場合は `about:addons` → MimicVault →「プライベートウィンドウでの実行を許可する」。

## 利用に関する注意事項
本リポジトリのソースコードおよび関連ドキュメントは、著作権者の明示的な許諾なく、
以下の行為を行うことを禁止します。

- 無断利用・無断複製
- 生成AI（LLM等）の学習データ・入力データとしての投入
- 商用利用
- 再配布
- 改変（フォーク・派生物の作成を含む）

詳細な利用許諾条件は [LICENSE](./LICENSE) を参照してください。
