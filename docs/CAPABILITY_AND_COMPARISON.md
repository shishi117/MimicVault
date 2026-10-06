# MimicVault の取得可能範囲と VideoDownloadHelper との比較

## 1. 取得・検出できる範囲(拡張機能側)

MimicVault は `webRequest`(ブラウザが発行する HTTP 通信を監視する API)でレスポンスを
覗き見る方式。**対象は HTTP(S) で流れるメディアのみ**で、WebRTC / RTMP / RTSP は仕組みの
外側のため検出不可能(`README.md`)。

| 規格 | 検出方法 | 取得(DL) | 制約 |
|---|---|---|---|
| 通常ファイル(mp4/webm/mkv 等) | DOM走査(`content/mediaDetect.js`)+`webRequest` | ブラウザ直DL | 拡張子固定リスト `MEDIA_EXTENSIONS` |
| HLS(.m3u8) | webRequest | companion経由MP4、未接続時は.ts結合 | 下記「暗号化・DRM」参照 |
| DASH(.mpd) | webRequest | トラック選択 + companion で mux | — |
| MSS(.ism/Manifest) | webRequest | DASH の URL 記法に書き換えて委譲(`background/ismToDashUrl.js`) | **動的パッケージャーのみ**。既知3記法(Unified Streaming/Azure/Wowza)を順に試すヒューリスティック。未知パッケージャーは失敗表示。静的Smooth(断片のみ・再パッケージ非対応)は非対応(moovビルダーが別途必要でコスト高) |
| 収集ストリーム(マニフェスト非露出MSE) | ディレクトリ単位でfMP4断片を収集(`background/segmentGroups.js`) | 結合してcompanionでremux | **再生し切った範囲のみ取得可**(ライブ録画と同じ制約)。1ディレクトリに複数レンディション混在だと先頭initを使うため壊れる場合あり。TS断片・連番.mp4・init無しSmooth Fragmentsは対象外 |

`background/domainFilter.js` でホワイトリスト/ブラックリスト(ワイルドカード対応)による
ドメイン単位の除外も可能。

## 2. companion アプリで変換できる範囲

Native Messaging(ブラウザ拡張がローカルのネイティブアプリとやり取りする仕組み)経由で
FFmpeg を呼び出す別プロセス(`companion/app.js`)。対応コマンドは3つのみ
(`companion/README.md`, `companion/lib/handleMessage.js`)。

- `convert`:HLS→MP4変換
- `mux`:DASHの映像+音声トラックを結合してMP4化
- `remux`:収集ストリームの結合済み断片→MP4

**companionが行わないこと**:インターネット以外へのデータ送信、変換完了ファイル以外の
データ保持。未接続時は検出はできても変換できず、生の.ts/断片化mp4のまま保存される。

## 3. 暗号化・DRMの制約

| 方式 | 対応状況 |
|---|---|
| AES-128(HLSの標準的な暗号化) | ✅対応。`background/hlsCrypto.js` で `SubtleCrypto`(ブラウザ標準の暗号API)により復号 |
| SAMPLE-AES | ❌非対応。`background/hlsMediaParse.js` で検出した時点でエラー、ポップアップにも「DRM保護コンテンツは未対応」と表示 |
| Widevine/PlayReady/FairPlay/EME(ライセンスサーバーと鍵交換する本格DRM) | ❌完全に非対応。コードベースに該当処理は一切なし。暗号化MSEを使うサイトは再生可能なURLとして観測できないため検出自体が不可 |

## 4. 既知の簡略化・アップグレードパス(次の実装候補)

コード内コメントで明示されている着手候補:

1. **静的Smooth Streaming対応**:CodecPrivateDataからfMP4 initを生成する「moovビルダー」が必要。コスト高。
2. **収集ストリームの複数レンディション分離**:v1は未対応。大半は実害なしだが混在レイアウトで壊れる。
3. **SAMPLE-AES/本格DRM**:ライセンス管理が必要な領域で、ブラウザ拡張単体では原理的に困難。
4. **WebRTC/RTMP/RTSP**:`webRequest`の検出モデルの前提から外れるため、対応するなら別アーキテクチャ(MediaRecorder APIでの録画等)が必要。

## 5. VideoDownloadHelper(VDH)との比較

VDH は非公開ソースの製品のため、以下は公開されている一般的な挙動・知識に基づく比較で
あり、MimicVault側のみコード確認済み。

### 5.1 対応形式/機能面

| 観点 | MimicVault | VDH |
|---|---|---|
| 通常ファイル/HLS/DASH | ✅両方対応 | ✅両方対応 |
| サイト別アダプタ(特定サイト専用の抽出ロジック) | **なし**。汎用的なURL/MIMEパターン検出のみ | **あり**。YouTube等主要サイト向けの専用抽出ロジック("variants")を長年蓄積 |
| マニフェスト非露出の独自プレイヤー(MSE) | ✅汎用フォールバックあり(収集ストリーム)。サイト名を知らなくても機械的に拾える | 専用variantが無いサイトは基本的に検出不可 |
| MSS(Smooth Streaming) | ✅明示対応 | 明示的な対応は一般に知られていない |
| DRM(Widevine等) | ❌非対応 | ❌非対応(両者共通の壁) |
| 出力フォーマットの種類 | `convert`/`mux`/`remux`の3種のみ。元画質のまま1本のMP4化に限定 | 有料版coappはMP4以外への変換・音声抽出など選択肢が広い |
| ブックマーク連携一括DL | ✅独自機能 | 一般には知られていない(MimicVault独自の可能性) |
| ライブ配信録画 | ✅30セグメント単位のチャンク分割保存 | ✅同様の機能を持つ(詳細非公開) |

### 5.2 アーキテクチャ/実装方式

| 観点 | MimicVault | VDH |
|---|---|---|
| 基本方式 | WebExtension(`webRequest`監視+DOM走査) | 同じくWebExtension方式 |
| 変換処理 | companionアプリ必須(Native Messaging経由でffmpeg実行) | 同様にcoapp(companion app)で同種の処理 |
| サイト別ルールの更新方式 | 完全ローカル・静的。companionはネットワーク外通信なし | サーバー側からvariant定義を取得・更新する方式と見られる(拡張更新なしで対応サイトが増減し得る) |
| 対応ブラウザ | Firefox限定(ESR/Developer Editionのみ、未署名のためRelease不可) | Firefox/Chrome/Edge等マルチブラウザ |
| 配布・インストール形態 | 未署名XPIをenterprise policyで強制インストール(個人/組織内利用前提) | 公式署名拡張としてAMO等から一般配布 |
| コードの透明性 | companion含め全てOSSとして閲覧・ビルド可能 | coappはクローズドソースのバイナリ配布 |

**まとめ**: 技術的な骨格(webRequest検出 + companionでffmpeg)はVDHと同じ発想だが、
MimicVaultは「サーバー通信ゼロ・完全ローカル・個人/小規模配布」を前提にした簡素な実装。
VDHは「多サイト対応のためのサーバー駆動ルール更新」という運用コストを払って広い対応範囲
を実現している。
