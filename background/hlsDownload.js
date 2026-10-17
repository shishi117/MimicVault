// background/hlsDownload.js — MimicVault
// HLS VOD セグメントダウンロード downloadHlsSegments

"use strict";

// stemOverride: 指定時はタブタイトル推定の代わりにこちらを使う
// （ブックマーク一括DL: background/bookmarkDownload.js が使用）
async function downloadHlsSegments(mediaPlaylistUrl, pageURL, tabId, stemOverride) {
  try {
    return await downloadHlsSegmentsInner(mediaPlaylistUrl, pageURL, tabId, stemOverride);
  } finally {
    // 進捗問い合わせキャッシュ（hlsProgressState）は成功・失敗問わず後片付けする。
    // 残したままだと、同じ URL を後で再ダウンロードした時に古い進捗が一瞬見える。
    hlsProgressState.delete(mediaPlaylistUrl);
  }
}

async function downloadHlsSegmentsInner(mediaPlaylistUrl, pageURL, tabId, stemOverride) {
  // ── companion 接続時は master/media 問わず FFmpeg に丸投げ ──────────────────
  // FFmpeg はプレイリスト URL を直接受け取り、master なら画質を自動選択し、
  // セグメント取得・復号・結合・MP4 変換までを一括で行う。よって以降の
  // fetch / master 判定 / パースは不要。失敗時のみ下の非 companion フローへ落ちる。
  if (companionPort) {
    try {
      return await downloadHlsViaCompanion(mediaPlaylistUrl, pageURL, tabId, stemOverride);
    } catch (err) {
      console.warn("[Companion] HLS 変換失敗、フォールバックへ:", err.message);
    }
  }

  // ── 1. Media Playlist fetch ──────────────────────────────────────────────
  if (pageURL) pendingReferers.set(mediaPlaylistUrl, pageURL);

  let text;
  try {
    const res = await fetch(mediaPlaylistUrl);
    pendingReferers.delete(mediaPlaylistUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    pendingReferers.delete(mediaPlaylistUrl);
    throw err;
  }

  // Master Playlist が渡された場合はエラー（バリアント選択が必要）
  if (isMasterPlaylist(text)) {
    return { ok: false, error: "master_playlist" };
  }

  // ── 2. パース & 暗号化キー取得 ───────────────────────────────────────────
  const parsed = parseMediaPlaylist(text, mediaPlaylistUrl);

  // SAMPLE-AES は未対応
  if (parsed.error === "sample_aes") {
    return { ok: false, error: "sample_aes" };
  }

  if (parsed.segments.length === 0) {
    return { ok: false, error: "no_segments" };
  }

  // ── ステップ10: ライブストリーム検出 ─────────────────────────────────────
  // companion なし or 失敗時のみライブ録画モードに移行する。
  // #EXT-X-ENDLIST がない = ライブ配信 → チャンク分割保存
  if (!parsed.ended) {
    return startLiveRecording(mediaPlaylistUrl, pageURL, parsed, tabId);
  }

  // ── VOD: 既存のセグメント一括ダウンロードフロー（blob / .ts）─────────────────
  let cryptoKey = null;
  if (parsed.keyInfo?.method === "AES-128") {
    try {
      cryptoKey = await fetchAesKey(parsed.keyInfo.uri, pageURL);
    } catch (err) {
      return { ok: false, error: `キー取得失敗: ${err.message}` };
    }
  }

  // ── 2.5 fMP4(CMAF) 初期化セグメント fetch ────────────────────────────────
  // #EXT-X-MAP があるプレイリストは MPEG-TS ではなく fMP4 で配信されている。
  // メディア断片（moof+mdat）だけでは moov/trex が無く再生できないため、
  // 初期化セグメント（ftyp+moov）を先頭に結合する必要がある
  // （収集ストリーム保存 downloadSegmentGroup.js の init 扱いと同じ考え方）。
  let initBuffer = null;
  if (parsed.initUri) {
    if (pageURL) pendingReferers.set(parsed.initUri, pageURL);
    try {
      const res = await fetch(parsed.initUri);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      initBuffer = await res.arrayBuffer();
    } catch (err) {
      return { ok: false, error: `初期化セグメント取得失敗: ${err.message}` };
    } finally {
      pendingReferers.delete(parsed.initUri);
    }
  }

  // ── 3. 並列セグメント fetch（＋必要なら復号） ─────────────────────────────
  const total = parsed.segments.length;

  // popup への進捗通知（popup が閉じていてもエラーにしない）。
  // ブロードキャスト（sendMessage）に加えて hlsProgressState にも書いておき、
  // ページに重ねるパネル（content script 注入の iframe）側は GET_HLS_PROGRESS
  // で問い合わせても同じ値を取れるようにする（ブロードキャストが届かない
  // 環境でも確実に進捗表示できるようにするための二重化）。
  const sendProgress = (current, t) => {
    hlsProgressState.set(mediaPlaylistUrl, { current, total: t, converting: false });
    browser.runtime.sendMessage({
      type:    "HLS_DOWNLOAD_PROGRESS",
      url:     mediaPlaylistUrl,
      current,
      total:   t,
    }).catch(() => {});
  };

  // 最初に 0/total を通知して UI をリセット
  sendProgress(0, total);

  // 暗号化あり・なしで worker の処理を分岐する
  const { keyInfo, mediaSequence, segments } = parsed;

  const buffers  = new Array(segments.length);
  let completed  = 0;
  let nextIdx    = 0;

  async function worker() {
    while (nextIdx < segments.length) {
      const idx = nextIdx++;
      const segUrl = segments[idx];
      // Referer 未登録だとセグメントだけ素の fetch になり、anti-leech な
      // 配信元（Referer/Origin チェックのある CDN 等）で 403 になる。
      if (pageURL) pendingReferers.set(segUrl, pageURL);
      const res = await fetch(segUrl);
      pendingReferers.delete(segUrl);
      if (!res.ok) throw new Error(`セグメント ${idx} の取得失敗: HTTP ${res.status}`);
      const raw = await res.arrayBuffer();

      if (cryptoKey) {
        // AES-128-CBC 復号
        // IV は EXT-X-KEY の IV 属性 or (mediaSequence + idx) から算出
        buffers[idx] = await decryptSegment(
          raw, cryptoKey, keyInfo.iv, mediaSequence, idx
        );
      } else {
        buffers[idx] = raw;
      }

      completed++;
      sendProgress(completed, segments.length);
    }
  }

  try {
    const workerCount = Math.min(4, segments.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ── 4. ArrayBuffer 結合 → Blob ────────────────────────────────────────────
  // initBuffer があれば先頭に結合する（fMP4: ftyp+moov に続けて moof+mdat の列）。
  const segBytes    = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const totalBytes  = (initBuffer?.byteLength ?? 0) + segBytes;
  const combined    = new Uint8Array(totalBytes);
  let offset = 0;
  if (initBuffer) {
    combined.set(new Uint8Array(initBuffer), offset);
    offset += initBuffer.byteLength;
  }
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  // URL は多くの配信元で "video.m3u8" 等の定型名なので、タブの表示タイトルが
  // 取れればそちらを優先する（以降の MP4/TS どちらの保存でも共通で使う）。
  const hlsStem = stemOverride ?? await inferTitleStem(mediaPlaylistUrl, tabId);

  // ── 4.5 まずそのまま保存する（確実に動作する経路） ───────────────────────────
  // fMP4（EXT-X-MAP あり）は init+moof+mdat のまま多くのプレイヤーで再生可能な
  // ので拡張子は mp4、無ければ従来どおり MPEG-TS 結合物なので拡張子は ts にする。
  const isFmp4        = !!initBuffer;
  const fallbackExt   = isFmp4 ? "mp4" : "ts";
  const blob    = new Blob([combined], { type: isFmp4 ? "video/mp4" : "video/mp2t" });
  const blobUrl = URL.createObjectURL(blob);
  const fallbackFilename = applyFilenameTemplate(hlsStem, fallbackExt);

  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url: blobUrl, filename: fallbackFilename });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    return { ok: false, error: err.message };
  }

  // browser.downloads.download() は書き込み開始を返すだけで、実際にディスクへ
  // 書き終わるのは非同期。ここで実際の完了（または中断）を待たずに ok:true を
  // 返すと、ポップアップ側は「✓完了」と表示するのに実ファイルは後から失敗して
  // 存在しない、という事故になる。companion の有無に関わらず必ず実完了を待つ。
  const fallbackDone = await awaitDownloadComplete(downloadId);
  URL.revokeObjectURL(blobUrl);

  if (!fallbackDone.ok) {
    return { ok: false, error: fallbackDone.error ?? "download_failed" };
  }

  // ── 4.6 companion 接続時は、保存したファイルをローカルファイルのまま MP4 に remux ──
  // downloadHlsViaCompanion（FFmpeg が自前で URL を直接 fetch する経路）が
  // anti-leech な配信元で失敗してここに落ちてきた場合でも、ブラウザの fetch
  // （Referer 注入済み）で取得済みのファイルをそのまま companion に渡せば、
  // FFmpeg はネットワークに触れずローカルファイルを読むだけで済む。
  //
  // 既知の上限: バイト列を base64 化して Native Messaging 経由で渡す方式
  // （downloadSegmentGroup.js と同じ）は、長時間の HLS 動画（数百MB〜）では
  // 1バイトずつの文字列結合 + 全体コピーが重すぎて実質ハングしたため不採用。
  // 代わりに browser.downloads でディスクに書き出した実ファイルのパスを渡し、
  // companion 側はそのパスを直接 ffmpeg -i に渡す（バイト列のやり取りをしない）。
  // remuxError: 未設定=companion未接続/試行せず、文字列=試行して失敗した理由
  // （ポップアップ側は fallbackExt が ts の時だけ注記にそのまま表示する。
  //   fallbackExt が mp4 なら既に再生可能なので、変換失敗は console のみでよい）。
  let remuxError;
  if (companionPort) {
    try {
      const [info] = await browser.downloads.search({ id: downloadId });
      const inputPath = info?.filename;
      if (inputPath) {
        const outputName = applyFilenameTemplate(hlsStem, "mp4");
        const result = await sendToCompanion(
          { type: "remux", inputPath, outputName },
          (prog) => {
            hlsProgressState.set(mediaPlaylistUrl, { current: prog.percent ?? 0, total: 100, converting: true });
            browser.runtime.sendMessage({
              type: "HLS_DOWNLOAD_PROGRESS", url: mediaPlaylistUrl,
              current: prog.percent ?? 0, total: 100, converting: true,
            }).catch(() => {});
          }
        );
        if (result.ok) {
          browser.downloads.removeFile(downloadId).catch(() => {});
          return { ok: true, downloadId: null, filePath: result.filePath };
        }
        remuxError = result.error ?? "remux failed";
        console.warn(`[HLS] remux 失敗、.${fallbackExt} のまま保持:`, remuxError);
      }
    } catch (err) {
      remuxError = err.message;
      console.warn(`[HLS] remux 例外、.${fallbackExt} のまま保持:`, remuxError);
    }
  }

  return { ok: true, downloadId, remuxError, fallbackExt };
}

