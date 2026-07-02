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

