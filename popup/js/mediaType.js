// popup/js/mediaType.js — MimicVault
// メディア種別判定 isHlsUrl/isTsSegment/isDashUrl

"use strict";

// ─── HLS アコーディオン ───────────────────────────────────────────────────────

/** URL が m3u8 かどうかを判定 */
function isHlsUrl(url) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

/** アイテムが HLS セグメント（.ts）かどうか */
function isTsSegment(item) {
  return /\.ts(\?|#|$)/i.test(item.url) || (item.mimeHint || "").includes("mp2t");
}

/** URL が MPEG-DASH MPD かどうかを判定 */
function isDashUrl(url) {
  return /\.mpd(\?|#|$)/i.test(url);
}

/**
 * ダウンロード法ラベルを同期的に返す（fetch 不要）。
 * DASH の "DASH/mux"（映像+音声あり）判定はメタ取得後に mediaMetaStore が上書きする。
 */
function mediaMethodLabel(item) {
  const isDash = isDashUrl(item.url) ||
    (item.mimeHint ?? "").includes("dash+xml") || (item.mimeHint ?? "").includes("mpd");
  if (isDash) return "DASH";
  const isHls = isHlsUrl(item.url) ||
    (item.mimeHint ?? "").includes("mpegurl") || (item.mimeHint ?? "").includes("m3u8");
  if (isHls) return "HLS";
  return "直接";
}

