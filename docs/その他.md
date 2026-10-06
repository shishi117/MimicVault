# 動画テストURLメモ

## 1. HLS（.m3u8）

| 提供元 | URL | 備考 |
| :--- | :--- | :--- |
| Apple公式 | https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8 | マルチバリアント（マスタープレイリスト）。画質選択の検証向き |
| Mux | https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 | 定番のマスタープレイリスト |
| Unified Streaming | https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8 | 音声トラック複数あり |

- 暗号化 HLS（AES-128）テスト: https://test-streams.mux.dev/pts_shift/master.m3u8（hlsCrypto.js の復号経路確認に）

## 2. DASH（.mpd）

| 提供元 | URL | 備考 |
| :--- | :--- | :--- |
| Akamai / DASH-IF | https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd | 映像/音声分離。自動トラック選択・mux の検証に最適 |
| Bitmovin | https://bitmovin-a.akamaihd.net/content/MI201109210084_1/mpd/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.mpd | マルチ解像度 |
| Unified Streaming | https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.mpd | 複数音声・字幕 |

## 3. 通常ファイル（.mp4 / .webm など直リンク）

| 種別 | URL |
| :--- | :--- |
| MP4 | https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4 |
| MP4（軽量） | https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4 |
| WebM | https://test-videos.co.uk/vids/bigbuckbunny/webm/vp9/360/Big_Buck_Bunny_360_10s_1MB.webm |
| MP4/WebM 両方（MDN） | https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4 / .webm |

---

## 検証のヒント

- content/mediaDetect.js は拡張子 mp4\|webm\|mkv\|mov\|avi\|ogg\|ogv\|flv\|m4v\|m3u8\|mpd と MIME で検出します。上記はすべて対象内です。
- `<video src>` として `document.write` するだけの簡単なテスト HTML をローカルに置けば、content-early.js / observe.js（DOM 監視）経路も一緒に確認できます。必要なら作ります。
- HLS→MP4・DASH mux は companion アプリ（Native Messaging）が動いている前提です。companion 未起動だと検出はできても変換で失敗するので、切り分け時は注意してください。

これらの外部 URL は時々配信が止まることがあります。
