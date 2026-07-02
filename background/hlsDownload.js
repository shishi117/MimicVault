// background/hlsDownload.js — MimicVault
// HLS VOD セグメントダウンロード downloadHlsSegments

"use strict";

async function downloadHlsSegments(mediaPlaylistUrl, pageURL, tabId) {
  // ── companion 接続時は master/media 問わず FFmpeg に丸投げ ──────────────────
  // FFmpeg はプレイリスト URL を直接受け取り、master なら画質を自動選択し、
  // セグメント取得・復号・結合・MP4 変換までを一括で行う。よって以降の
  // fetch / master 判定 / パースは不要。失敗時のみ下の非 companion フローへ落ちる。
  if (companionPort) {
    try {
      return await downloadHlsViaCompanion(mediaPlaylistUrl, pageURL);
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

  // ── 3. 並列セグメント fetch（＋必要なら復号） ─────────────────────────────
  const total = parsed.segments.length;

  // popup への進捗通知（popup が閉じていてもエラーにしない）
  const sendProgress = (current, t) => {
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
      const res = await fetch(segments[idx]);
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
  const totalBytes = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const combined   = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  const blob    = new Blob([combined], { type: "video/mp2t" });
  const blobUrl = URL.createObjectURL(blob);

  // ── 5. ダウンロード開始 ───────────────────────────────────────────────────
  // HLS セグメント結合物は必ず MPEG-TS コンテナなので拡張子を .ts に強制する。
  // playlist URL が video.mp4?format=m3u8 のような形でも誤った .mp4 にならない。
  const hlsStem = inferStem(mediaPlaylistUrl);
  const filename = applyFilenameTemplate(hlsStem, "ts");

  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url: blobUrl, filename });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    return { ok: false, error: err.message };
  }

  // Blob URL はダウンロード完了後に解放（onChanged で revoke）
  // 安全のため最大 10 分のタイムアウトも設ける
  const revokeTimer = setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);

  browser.downloads.onChanged.addListener(function onDlChanged(delta) {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === "complete" || state === "interrupted") {
      clearTimeout(revokeTimer);
      URL.revokeObjectURL(blobUrl);
      browser.downloads.onChanged.removeListener(onDlChanged);
    }
  });

  return { ok: true, downloadId };
}

