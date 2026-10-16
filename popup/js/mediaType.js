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
  // 収集ストリーム（孤立セグメントグループ）
  if (item.isSegmentGroup) return "収集";
  // MSS は addToStore で DASH URL に正規化済み。ラベルだけ由来を明示する。
  if (item.viaMss) return "MSS→DASH";
  const isDash = isDashUrl(item.url) ||
    (item.mimeHint ?? "").includes("dash+xml") || (item.mimeHint ?? "").includes("mpd");
  if (isDash) return "DASH";
  const isHls = isHlsUrl(item.url) ||
    (item.mimeHint ?? "").includes("mpegurl") || (item.mimeHint ?? "").includes("m3u8");
  if (isHls) return "HLS";
  // 通常の progressive 直リンク。downloadDirectRanged.js が再生時のような
  // Range 分割リクエストで取得するため、ラベルもそれに合わせる。
  return "mp4分割";
}

