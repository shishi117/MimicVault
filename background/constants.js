// background/constants.js — MimicVault
// 検出用の正規表現・しきい値・Referer 保留マップ（共有定数/状態）

"use strict";

// ─── 定数 ────────────────────────────────────────────────────────────────────

/** メディアと判断する Content-Type */
const MEDIA_MIME_RE = /^(video|audio)\//i;

/** HLS / DASH マニフェスト系の Content-Type */
const MANIFEST_MIME_RE = /^application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)/i;

/** URL 拡張子ベースの判定（MIME が不正確なサーバー対策） */
const MEDIA_URL_RE = /\.(mp4|webm|mkv|mov|m4v|ogg|ogv|ts|m2ts|m3u8|mpd|m4s|m4a|mp3|aac|flac|opus|wav)(\?|#|$)/i;

/** 誤検知を防ぐための除外 MIME */
const EXCLUDE_MIME_RE = /^(image|text|font|application\/(javascript|json|xml$))/i;

/** Content-Length が取れる場合の最小サイズ（1 KB）*/
const MIN_CONTENT_LENGTH = 1024;

// ─── Referer 注入用ペンディングマップ ────────────────────────────────────────
/**
 * ダウンロード開始直前に登録し、onBeforeSendHeaders で注入後に削除する。
 * key:   ダウンロード対象 URL
 * value: 注入する Referer 値（元ページの URL）
 *
 * 注意: URL が全く同じファイルを同時にダウンロードするケースは稀だが、
 *       その場合も最後に登録された Referer が使われる（許容範囲）。
 */
const pendingReferers = new Map();

