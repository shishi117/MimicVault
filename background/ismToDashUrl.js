// background/ismToDashUrl.js — MimicVault
// Smooth Streaming マニフェスト URL を DASH 形式へ書き換える ismToDashCandidates/isMssUrl

"use strict";

// ─── Microsoft Smooth Streaming (MSS) 対応 ───────────────────────────────────
//
// Smooth Streaming クライアントマニフェストの URL 形状:
//   https://host/path/video.ism/Manifest
//   https://host/path/video.ism/manifest(format=m3u8-aapl)   ← 既存 format 付き
//
// 動的パッケージャーは同じ .ism から DASH(MPD) も配信するが、DASH の URL 記法は
// 実装ごとに異なる（実測: Unified Streaming=.ism/.mpd, Microsoft/Azure/IIS=
// manifest(format=mpd-time-csf), Wowza=manifest.mpd）。単一決め打ちは脆いため、
// 既知の記法を順に試し、MPD として解釈できた最初の URL を使う（fetchDashInfo）。
//
// 既知の簡略化 / アップグレードパス:
//   候補リストは主要 3 記法のヒューリスティック。未知のパッケージャーは全候補が
//   失敗し「静的 Smooth 相当」としてエラー表示される。新記法は下の配列に追記する。
//   静的 Smooth（断片のみ・動的リパッケージ非対応）は CodecPrivateData からの
//   fMP4 init 生成（moov ビルダー）が必要でコストが高いため本対応の範囲外。

/** MSS クライアントマニフェスト URL か（.ism/Manifest 形状 or sstr MIME） */
function isMssUrl(url, mimeHint = "") {
  return /\.isml?\/manifest(\(|\?|#|$)/i.test(url) ||
         /vnd\.ms-sstr\+xml/i.test(mimeHint);
}

/**
 * .ism/Manifest URL から DASH(MPD) 候補 URL を優先順に返す。
 * `.ism` 直後の `/Manifest(...)` 部分だけを各記法で差し替える（クエリは保持）。
 * MSS 形状でなければ元 URL 1 件のみを返す。
 */
function ismToDashCandidates(url) {
  const m = url.match(/^(.*?\.isml?)\/manifest(?:\([^)]*\))?/i);
  if (!m) return [url];
  const base = m[1];                 // "...video.ism"
  const tail = url.slice(m[0].length); // 残り（?query など）
  return [
    `${base}/.mpd${tail}`,                          // Unified Streaming
    `${base}/manifest(format=mpd-time-csf)${tail}`, // Microsoft / Azure / IIS
    `${base}/manifest.mpd${tail}`,                  // Wowza
  ];
}

// node 単体テスト用（拡張機能コンテキストでは module 未定義なのでスキップ）
if (typeof module !== "undefined") module.exports = { isMssUrl, ismToDashCandidates };
