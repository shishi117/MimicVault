// background/downloadDashTrack.js — MimicVault
// DASH 単一トラックダウンロード downloadDashTrack

"use strict";

async function downloadDashTrack({ rep, mpdUrl, mpdDuration, trackType, pageURL, tabId }) {
  const { id, bandwidth, segInfo } = rep;

  // ── セグメント URL を展開 ──────────────────────────────────────────────
  const { initUrl, initBytes, segUrls } = expandSegmentUrls(segInfo, id, bandwidth, mpdDuration);

  if (segUrls.length === 0) {
    return { ok: false, error: "no_segments" };
  }

  const total = segUrls.length;
  let completed = 0;

  const sendProgress = (current, t) => {
    browser.runtime.sendMessage({
      type:    "DASH_DOWNLOAD_PROGRESS",
      mpdUrl,
      repId:   id,
      current,
      total:   t,
    }).catch(() => {});
  };

  sendProgress(0, total);

  // ── init セグメントを先頭に積む（fMP4 の moov ボックス）──────────────
  // MSS(静的Smooth)は initBytes(自前生成済み)を優先し、fetch しない。
  let initBuf = null;
  if (initBytes) {
    initBuf = initBytes;
  } else if (initUrl) {
    if (pageURL) pendingReferers.set(initUrl, pageURL);
    try {
      const res = await fetch(initUrl);
      pendingReferers.delete(initUrl);
      if (!res.ok) throw new Error(`init fetch HTTP ${res.status}`);
      initBuf = await res.arrayBuffer();
    } catch (err) {
      pendingReferers.delete(initUrl);
      return { ok: false, error: `init: ${err.message}` };
    }
  }

  // ── media セグメントを並列 fetch（最大 4 並列）────────────────────────
  const mediaBufs = new Array(segUrls.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < segUrls.length) {
      const idx    = nextIdx++;
      const segUrl = segUrls[idx];
      if (pageURL) pendingReferers.set(segUrl, pageURL);
      const res = await fetch(segUrl);
      pendingReferers.delete(segUrl);
      if (!res.ok) throw new Error(`seg ${idx} HTTP ${res.status}`);
      mediaBufs[idx] = await res.arrayBuffer();
      completed++;
      sendProgress(completed, total);
    }
  }

  try {
    const workerCount = Math.min(4, segUrls.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ── [init] + media セグメントを結合 ──────────────────────────────────
  const allBufs    = initBuf ? [initBuf, ...mediaBufs] : [...mediaBufs];
  const totalBytes = allBufs.reduce((s, b) => s + (b?.byteLength ?? 0), 0);
  const combined   = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of allBufs) {
    if (buf) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
  }

  // ── Blob 化してダウンロード ────────────────────────────────────────────
  const blobMime = trackType === "audio" ? "audio/mp4" : "video/mp4";
  const blob     = new Blob([combined], { type: blobMime });
  const blobUrl  = URL.createObjectURL(blob);

  // ファイル名: <動画タイトルらしきもの + mpdステム>_<trackType>_<repId>.<ext>
  // 例: "動画タイトル 1080p_video_1.mp4" / "動画タイトル 1080p_audio_10.m4a"
  const ext  = trackType === "audio" ? "m4a" : "mp4";
  const stem = await inferTitleStem(mpdUrl, tabId);
  const filename = applyFilenameTemplate(`${stem}_${trackType}_${id}`, ext);

  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url: blobUrl, filename });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    return { ok: false, error: err.message };
  }

  // Blob URL をダウンロード完了後に解放
  const revokeTimer = setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
  browser.downloads.onChanged.addListener(function onDone(delta) {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === "complete" || state === "interrupted") {
      clearTimeout(revokeTimer);
      URL.revokeObjectURL(blobUrl);
      browser.downloads.onChanged.removeListener(onDone);
    }
  });

  return { ok: true, downloadId };
}

