// background/urlHelpers.js — MimicVault
// URL からの stem/拡張子推定 inferStem/inferExt/mimeToExt

"use strict";

// ─── ダウンロード ヘルパー ────────────────────────────────────────────────────

/**
 * URL からファイル名ステム（拡張子なし）を取り出す。
 * %title テンプレート展開の基礎値として使用する。
 */
function inferStem(url) {
  try {
    const pathname = new URL(url).pathname;
    const raw = pathname.split("/").filter(Boolean).pop() ?? "";
    const name = raw.split("?")[0] || "media";
    return name.replace(/\.[a-z0-9]{2,5}$/i, "") || "media";
  } catch (_) { return "media"; }
}

/**
 * URL と MIME から拡張子文字列（ドットなし）を返す。
 */
function inferExt(url, mimeHint) {
  // URL に既知の拡張子があればそれを使う
  const m = url.match(/\.([a-z0-9]{2,5})(\?|#|$)/i);
  if (m) return m[1].toLowerCase();
  // なければ MIME から補完
  return mimeToExt(mimeHint ?? "");
}

/** MIME タイプ → 拡張子のマッピング */
function mimeToExt(mime) {
  const m = mime.split(";")[0].trim().toLowerCase();
  return {
    "video/mp4":               "mp4",
    "video/webm":              "webm",
    "video/x-matroska":        "mkv",
    "video/quicktime":         "mov",
    "video/ogg":               "ogv",
    "video/mp2t":              "ts",
    "video/iso.segment":       "m4s",
    "audio/mpeg":              "mp3",
    "audio/aac":               "aac",
    "audio/flac":              "flac",
    "audio/opus":              "opus",
    "audio/mp4":               "m4a",
    "audio/wav":               "wav",
    "audio/ogg":               "ogg",
    "application/x-mpegurl":   "m3u8",
    "application/vnd.apple.mpegurl": "m3u8",
    "application/dash+xml":    "mpd",
  }[m] ?? "";
}

