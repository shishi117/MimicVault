// background/mediaTypeDetect.js — MimicVault
// メディア種別判定 isHlsUrl/isDashUrl/isTsUrl/isHlsOrDashUrl
//
// webRequest.js の粗い検出（MEDIA_MIME_RE等。constants.js参照）を通過したアイテムに対し、
// mediaStore.js/messageRouter.js/mediaMeta.js/bookmarkDownload.js に個別に手書きされていた
// 「HLSかDASHかTSか」の正規表現判定（ほぼ同一内容）をここに集約する。
// popup/js/mediaType.js（popup側の同種の判定）の background 版。

"use strict";

/** URL / mimeHint から HLS(m3u8) かどうかを判定 */
function isHlsUrl(url, mimeHint) {
  const mime = mimeHint ?? "";
  return /\.m3u8(\?|#|$)/i.test(url) || mime.includes("mpegurl") || mime.includes("m3u8");
}

/** URL / mimeHint から MPEG-DASH(MPD) かどうかを判定 */
function isDashUrl(url, mimeHint) {
  const mime = mimeHint ?? "";
  return /\.mpd(\?|#|$)/i.test(url) || mime.includes("dash+xml") || mime.includes("mpd");
}

/** URL / mimeHint から HLS セグメント(.ts)かどうかを判定 */
function isTsUrl(url, mimeHint) {
  const mime = mimeHint ?? "";
  return /\.ts(\?|#|$)/i.test(url) || mime.includes("mp2t");
}

/** HLS または DASH（MSS正規化後も含む）かどうかを判定 */
function isHlsOrDashUrl(url, mimeHint) {
  return isHlsUrl(url, mimeHint) || isDashUrl(url, mimeHint);
}

// 自己チェック（CLAUDE.md: 非自明なロジックに実行可能チェックを1つ残す）
(function selfCheck() {
  const cases = [
    [isHlsUrl("https://h/v.m3u8", ""), true],
    [isHlsUrl("https://h/v?x=1", "application/vnd.apple.mpegurl"), true],
    [isDashUrl("https://h/v.mpd", ""), true],
    [isDashUrl("https://h/v?x=1", "application/dash+xml"), true],
    [isTsUrl("https://h/seg.ts", ""), true],
    [isHlsOrDashUrl("https://h/v.mp4", "video/mp4"), false],
  ];
  for (const [got, want] of cases) {
    if (got !== want) console.error("[mediaTypeDetect] selfCheck 失敗:", got, "≠", want);
  }
})();

if (typeof module !== "undefined") {
  module.exports = { isHlsUrl, isDashUrl, isTsUrl, isHlsOrDashUrl };
}
