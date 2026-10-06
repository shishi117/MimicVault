# HLS→MP4 変換が失敗したときの調査手順

companion（FFmpeg）経由のHLS→MP4変換が、特定のサイトでだけ失敗する場合の切り分け手順。
勝手に「ヘッダーが足りないはず」等と決めつけて直さず、**必ずこの順番で実機確認してから直す**こと
（CLAUDE.md「バグ修正とは、症状ではなく根本原因に対処すること」）。

## 症状の例

拡張機能のコンソールに `[Companion] HLS 変換失敗、フォールバックへ: ffmpeg が終了コード ... で失敗しました` と出て、
詳細に `Error opening input: Invalid data found when processing input` が続く。

この1つのエラー文言は原因が複数ある（下記）。文言だけで決め打ちしない。

## 手順

### 1. ブラウザの実際のリクエストを確認する

対象サイトでFirefoxの開発者ツール → ネットワークタブ → `m3u8` でフィルタ → 動画再生 →
該当リクエストを右クリック →「リクエストをコピー」→「cURLとしてコピー」。

これでブラウザが実際に送っているヘッダー（Referer/Origin/User-Agent/Cookie の有無等）が分かる。

### 2. そのcurlコマンドをそのまま実行する

**Windowsのコマンドプロンプト**で実行すること（ブラウザの開発者ツールのコンソールではない。
`curl is not defined` と出たら実行場所を間違えている）。

- プレイリスト（`.m3u8`）が正しく取得できるか
- セグメント（`video0.ts` 等、拡張子が偽装されている場合もある）も1つ直接取得できるか
  （`-o out.ts` 等でファイルに保存し、サイズが実データ分あるか確認）

ここで成功するなら、**ヘッダー不足が原因ではない**。次のサイトがヘッダーの問題だと決めつけて
`-headers` をいじるのは時間の無駄なので、必ずここを先にやる。

### 3. companionを介さず ffmpeg を直接 `-loglevel debug` で実行する

curlで取得できるのにcompanion経由だけ失敗するなら、ffmpeg自身が何をしているかを見るしかない。

```
ffmpeg.exe -loglevel debug -user_agent "<UA>" -headers "Referer: <referer>\r\nOrigin: <origin>\r\n" ^
  -allowed_extensions ALL -protocol_whitelist http,https,tcp,tls,crypto ^
  -i "<m3u8のURL>" -c copy test_out.mp4 > debug.log 2>&1
```

`debug.log` に実際に送信したHTTPリクエストと、エラーの直前の行が出る。見るポイント:

- `request:` の直後に出る生のHTTPヘッダー（意図した値が本当に送られているか）
- `is not in allowed_extensions` / `is not in allowed_segment_extensions` という行があるか
  → セグメントや参照ファイルの拡張子がFFmpegの許可リストに無い、という意味。
    `-allowed_extensions` と `-allowed_segment_extensions` は**別物**（下記参照）。
- `Unrecognized option 'xxx'` → そのFFmpegのバージョンにそのオプション自体が無い。
  古いFFmpegと新しいFFmpegで対応状況が異なるオプションがある。

## 今回（surrit.com）分かったこと・既知の落とし穴

- **`-headers` に `User-Agent: ...` を混ぜても上書きにならない**。FFmpegは常に自前の
  User-Agent（既定 `Lavf/x.y.z`）を送るため、`-headers`に書いた分と重複して2本送られる。
  User-Agentは専用の `-user_agent` オプションで渡すこと。
- **`-allowed_extensions` はセグメント本体には効かない**。比較的新しいFFmpeg
  （2026年頃のビルドで確認）は `-allowed_segment_extensions` という別オプションを持ち、
  既定では `.ts` 等の標準的な拡張子しか許可しない。セグメントを `.jpeg` 等に偽装している
  配信元（surrit.com 等）では、ここで弾かれて `Invalid data found when processing input` に
  なる。古いFFmpegにはこのオプション自体が無く、渡すと起動自体が失敗するため、
  `companion/lib/ffmpeg.js` の `supportsAllowedSegmentExtensions()` で対応状況を確認してから
  付与している（`ffmpeg -hide_banner -h demuxer=hls` の出力に文字列が含まれるかで判定）。
- 今回のサイトは独自の `#EXT-X-TOKEN=...` という非標準タグをプレイリストに含んでいたが、
  FFmpegは未知の `#EXT-X-*` 行を無視して問題なく処理できた。惑わされないこと。
- Range ヘッダー（FFmpegは `-i` の対象URLに常に `Range: bytes=0-` を付ける）や
  Accept-Encoding の有無は、今回のケースでは無関係だった（curlで同条件を試して確認済み）。

## 方針：サイト別分岐は作らない

上記の対応（`-user_agent` の利用、Referer/Origin/Sec-Fetch-* ヘッダー、
`-allowed_segment_extensions`）は**どれも特定ドメインを判定しない汎用的な設定**にしている。
新しいサイトで同様の失敗が起きても、まずはこの手順で原因を切り分け、本当に他サイトと
矛盾する要件が出てこない限りサイト別分岐（ドメイン判定の if 分岐）は追加しないこと
（YAGNI。要件が実際に衝突するまで作らない）。
