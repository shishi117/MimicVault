// background/downloadDashAndMux.js — MimicVault
// DASH 映像+音声 自動 mux downloadDashAndMux

"use strict";

// ─── DASH 映像+音声 自動 mux（v0.18.0） ──────────────────────────────────────
/**
 * DASH の映像・音声トラックを両方ダウンロードし、companion の mux コマンドで
 * 1つの MP4 ファイルに結合する。
 *
 * companion 未接続の場合は従来の別ファイル DL にフォールバックし、
 * popup に DASH_MUX_FALLBACK を通知する。
 *
 * メッセージ形式（popup → background）:
 *   {
 *     type:        "DOWNLOAD_DASH_MUX",
 *     videoRep:    Representation,   // 映像トラック
 *     audioRep:    Representation,   // 音声トラック
 *     mpdUrl:      string,
 *     mpdDuration: number,
 *     pageURL:     string,
 *     tabId:       number,          // ファイル名に動画タイトルを使うため
 *   }
 *
 * 返り値:
 *   { ok: true,  muxed: true,  filePath }   — mux 成功
 *   { ok: true,  muxed: false }             — フォールバック（別ファイルDL）
 *   { ok: false, error }                    — 失敗
 */
async function downloadDashAndMux({ videoRep, audioRep, mpdUrl, mpdDuration, pageURL, tabId }) {
  // companion 未接続 → 別ファイルフォールバック
  if (!companionPort) {
    browser.runtime.sendMessage({ type: "DASH_MUX_FALLBACK" }).catch(() => {});
    const vRes = await downloadDashTrack({ rep: videoRep, mpdUrl, mpdDuration, trackType: "video", pageURL, tabId });
    const aRes = await downloadDashTrack({ rep: audioRep, mpdUrl, mpdDuration, trackType: "audio", pageURL, tabId });
    return { ok: true, muxed: false, videoResult: vRes, audioResult: aRes };
  }

  // ── 映像・音声セグメントを blob として取得（DL せずバッファに保持）──────
  async function fetchTrackToBlob(rep, trackType) {
    const { id, bandwidth, segInfo } = rep;
    const { initUrl, initBytes, segUrls } = expandSegmentUrls(segInfo, id, bandwidth, mpdDuration);
    if (segUrls.length === 0) throw new Error(`no_segments (${trackType})`);

    const allBufs = [];

    // MSS(静的Smooth)は initBytes(自前生成済み)を優先し、fetch しない。
    if (initBytes) {
      allBufs.push(initBytes);
    } else if (initUrl) {
      if (pageURL) pendingReferers.set(initUrl, pageURL);
      const res = await fetch(initUrl);
      pendingReferers.delete(initUrl);
      if (!res.ok) throw new Error(`init HTTP ${res.status}`);
      allBufs.push(await res.arrayBuffer());
    }

    let nextIdx = 0;
    const mediaBufs = new Array(segUrls.length);
    let completed = 0;

    const sendProg = (cur) => {
      browser.runtime.sendMessage({
        type: "DASH_MUX_PROGRESS", mpdUrl,
        phase: trackType, current: cur, total: segUrls.length,
      }).catch(() => {});
    };
    sendProg(0);

    async function worker() {
      while (nextIdx < segUrls.length) {
        const idx = nextIdx++;
        const segUrl = segUrls[idx];
        if (pageURL) pendingReferers.set(segUrl, pageURL);
        const res = await fetch(segUrl);
        pendingReferers.delete(segUrl);
        if (!res.ok) throw new Error(`seg ${idx} HTTP ${res.status}`);
        mediaBufs[idx] = await res.arrayBuffer();
        sendProg(++completed);
      }
    }
    const wc = Math.min(4, segUrls.length);
    await Promise.all(Array.from({ length: wc }, worker));

    allBufs.push(...mediaBufs);
    const totalBytes = allBufs.reduce((s, b) => s + (b?.byteLength ?? 0), 0);
    const combined   = new Uint8Array(totalBytes);
    let offset = 0;
    for (const buf of allBufs) {
      if (buf) { combined.set(new Uint8Array(buf), offset); offset += buf.byteLength; }
    }
    const mime = trackType === "audio" ? "audio/mp4" : "video/mp4";
    return new Blob([combined], { type: mime });
  }

  let videoBlob, audioBlob;
  try {
    [videoBlob, audioBlob] = await Promise.all([
      fetchTrackToBlob(videoRep, "video"),
      fetchTrackToBlob(audioRep, "audio"),
    ]);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ── companion に blob を base64 で渡して mux ────────────────────────────
  async function blobToBase64(blob) {
    const ab  = await blob.arrayBuffer();
    const ua  = new Uint8Array(ab);
    let bin   = "";
    for (let i = 0; i < ua.length; i++) bin += String.fromCharCode(ua[i]);
    return btoa(bin);
  }

  const [videoB64, audioB64] = await Promise.all([
    blobToBase64(videoBlob),
    blobToBase64(audioBlob),
  ]);

  const stem       = await inferTitleStem(mpdUrl, tabId);
  const outputName = applyFilenameTemplate(stem, "mp4");

  let result;
  try {
    result = await sendToCompanion(
      { type: "mux", videoB64, audioB64, outputName },
      (prog) => {
        browser.runtime.sendMessage({
          type: "DASH_MUX_PROGRESS", mpdUrl,
          phase: "muxing", current: prog.percent ?? 0, total: 100,
        }).catch(() => {});
      }
    );
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!result.ok) return { ok: false, error: result.error ?? "mux failed" };
  return { ok: true, muxed: true, filePath: result.filePath };
}

