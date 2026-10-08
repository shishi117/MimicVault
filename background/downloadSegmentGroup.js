// background/downloadSegmentGroup.js — MimicVault
// 収集した fMP4/TS 断片グループを再取得・結合して保存する downloadSegmentGroup

"use strict";

// ─── 汎用 MSE / 孤立セグメント収集: ダウンロード ─────────────────────────────
//
// グループの断片（fMP4: init + メディア断片 / TS: init無しでメディア断片のみ）を
// 順序どおり再取得して結合する。companion 接続時は remux(ffmpeg -c copy)で正規の
// progressive MP4 に、未接続時は結合したバイト列をそのまま保存する
// （fMP4 は init+moof+mdat のまま多くのプレイヤーで再生可能、TS は単純結合だけで
// 有効な MPEG-TS になる。HLS の .ts 結合と同じ）。
//
// 既知の制限: 断片は元 URL を GET で再取得するため、署名付き一時 URL は失効しうる。

async function downloadSegmentGroup({ groupKey, tabId }) {
  const grp = getSegmentGroupUrls(tabId, groupKey);
  if (!grp || grp.media.length === 0) return { ok: false, error: "no_segments" };

  const { init, media, pageURL, stem } = grp;
  const urls  = init ? [init, ...media] : media;
  const total = urls.length;
  const trackUrl = "mvgroup:" + groupKey;

  // init が無く、断片が .ts なら生の MPEG-TS 断片群（結合するだけで有効な .ts になる）。
  // companion 未接続時はこのまま保存するため、拡張子/MIMEも .ts にする
  // （.mp4 と偽ると多くのプレイヤーで再生できない）。
  const isTs = !init && /\.ts(\?|#|$)/i.test(media[0] ?? "");

  const sendProgress = (cur, tot, phase) => {
    browser.runtime.sendMessage({
      type: "SEGMENT_GROUP_PROGRESS", url: trackUrl, current: cur, total: tot, phase,
    }).catch(() => {});
  };
  sendProgress(0, total);

  // ── 並列 fetch（Referer 注入）→ 結合 ─────────────────────────────────────
  const buffers = new Array(total);
  let nextIdx = 0, completed = 0;

  async function worker() {
    while (nextIdx < total) {
      const idx = nextIdx++;
      const u = urls[idx];
      if (pageURL) pendingReferers.set(u, pageURL);
      let res;
      try {
        res = await fetch(u);
      } finally {
        pendingReferers.delete(u);
      }
      if (!res.ok) throw new Error(`セグメント ${idx} の取得失敗: HTTP ${res.status}`);
      buffers[idx] = await res.arrayBuffer();
      sendProgress(++completed, total);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const totalBytes = buffers.reduce((s, b) => s + (b?.byteLength ?? 0), 0);
  const combined   = new Uint8Array(totalBytes);
  let off = 0;
  for (const b of buffers) {
    if (b) { combined.set(new Uint8Array(b), off); off += b.byteLength; }
  }

  // remux（companion）は常に正規 MP4 を出力するため拡張子は mp4 で固定。
  // 未接続/失敗時の直接保存のみ、.ts 断片なら .ts 拡張子で保存する。
  const remuxOutputName    = applyFilenameTemplate(stem || "stream", "mp4");
  const fallbackOutputName = isTs ? applyFilenameTemplate(stem || "stream", "ts") : remuxOutputName;

  // ── companion 接続時は remux で正規 MP4 に ──────────────────────────────
  if (companionPort) {
    try {
      let bin = "";
      for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
      const inputB64 = btoa(bin);
      const result = await sendToCompanion(
        { type: "remux", inputB64, outputName: remuxOutputName },
        (prog) => sendProgress(prog.percent ?? 0, 100, "remux")
      );
      if (result.ok) return { ok: true, muxed: true, filePath: result.filePath };
      console.warn("[SegmentGroup] remux 失敗、直接保存へ:", result.error);
    } catch (err) {
      console.warn("[SegmentGroup] remux 例外、直接保存へ:", err.message);
    }
  }

  // ── companion 未接続 / 失敗時: 結合した断片をそのまま保存 ──────────────────
  const blob    = new Blob([combined], { type: isTs ? "video/mp2t" : "video/mp4" });
  const blobUrl = URL.createObjectURL(blob);
  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url: blobUrl, filename: fallbackOutputName });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    return { ok: false, error: err.message };
  }

  const revokeTimer = setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
  browser.downloads.onChanged.addListener(function onCh(delta) {
    if (delta.id !== downloadId) return;
    const st = delta.state?.current;
    if (st === "complete" || st === "interrupted") {
      clearTimeout(revokeTimer);
      URL.revokeObjectURL(blobUrl);
      browser.downloads.onChanged.removeListener(onCh);
    }
  });

  return { ok: true, muxed: false, downloadId };
}
