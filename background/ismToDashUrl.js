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
//   候補リストは主要 3 記法のヒューリスティック。未知の動的パッケージャーは
//   新記法を下の配列に追記する。全候補が失敗した場合（＝静的 Smooth）は
//   resolveMssDashUrl（fetchDashInfo.js）が null を返し、呼び出し元が
//   mssManifestParse.js で .ism/Manifest を直接パースする経路に切り替える
//   （対応コーデック・暗号化の制限は README.md の MSS の制限を参照）。

/** MSS クライアントマニフェスト URL か（.ism/Manifest 形状 or sstr MIME） */
function isMssUrl(url, mimeHint = "") {
  return /\.isml?\/manifest(\(|\?|#|$)/i.test(url) ||
         /vnd\.ms-sstr\+xml/i.test(mimeHint);
}

/**
 * .ism/Manifest URL から「.ism ベースURL」と「残り(クエリ等)」を取り出す。
 * MSS 形状でなければ null を返す。
 * DASH 候補生成(ismToDashCandidates)と静的MSSパーサ(mssManifestParse.js)の
 * 両方から参照される共有ヘルパー。
 */
function ismBaseUrl(url) {
  const m = url.match(/^(.*?\.isml?)\/manifest(?:\([^)]*\))?/i);
  if (!m) return null;
  return { base: m[1], tail: url.slice(m[0].length) };
}

/**
 * .ism/Manifest URL から DASH(MPD) 候補 URL を優先順に返す。
 * `.ism` 直後の `/Manifest(...)` 部分だけを各記法で差し替える（クエリは保持）。
 * MSS 形状でなければ元 URL 1 件のみを返す。
 */
function ismToDashCandidates(url) {
  const resolved = ismBaseUrl(url);
  if (!resolved) return [url];
  const { base, tail } = resolved;
  return [
    `${base}/.mpd${tail}`,                          // Unified Streaming
    `${base}/manifest(format=mpd-time-csf)${tail}`, // Microsoft / Azure / IIS
    `${base}/manifest.mpd${tail}`,                  // Wowza
  ];
}

// node 単体テスト用（拡張機能コンテキストでは module 未定義なのでスキップ）
if (typeof module !== "undefined") module.exports = { isMssUrl, ismToDashCandidates, ismBaseUrl };
