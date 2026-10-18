// background/autoDashMux.js — MimicVault
// 全DL用 DASH 既定トラック自動選択+mux autoDashMux
"use strict";

// 全DL（DOWNLOAD_MEDIA_ALL）から呼ばれる。MPD を取得・解析し、
// 既定トラック（最高帯域の映像・音声＝videoReps[0]/audioReps[0]）を選んで mux する。
// 映像/音声どちらか一方のみの MPD は単一トラック DL にフォールバックする。
// stemOverride: 指定時はタブタイトル推定の代わりにこちらを使う
// （ブックマーク一括DL: background/bookmarkDownload.js が使用）
async function autoDashMux(item, tabId, stemOverride) {
  const info = await fetchDashInfo(item.url, item.pageURL || "");
  if (!info.ok) throw new Error(info.error || "mpd_parse_failed");

  const mpdUrl      = item.url;
  const mpdDuration = info.mpdDuration ?? 0;
  const pageURL     = item.pageURL || "";
  const videoRep    = info.videoReps[0];  // 帯域降順ソート済み → 最高品質
  const audioRep    = info.audioReps[0];

  if (videoRep && audioRep) {
    return downloadDashAndMux({ videoRep, audioRep, mpdUrl, mpdDuration, pageURL, tabId, stemOverride });
  }
  // 片方のみ → 単一トラック DL（結合不要）
  const rep       = videoRep ?? audioRep;
  const trackType = videoRep ? "video" : "audio";
  return downloadDashTrack({ rep, mpdUrl, mpdDuration, trackType, pageURL, tabId, stemOverride });
}
