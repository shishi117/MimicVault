// background/segmentGroups.js — MimicVault
// マニフェスト非露出の MSE 断片をディレクトリ単位で収集する
// isSegmentUrl/recordSegment/getSegmentGroupUrls

"use strict";

// ─── 汎用 MSE / 孤立セグメント収集 ───────────────────────────────────────────
//
// .mpd/.m3u8 を露出しない独自プレイヤー（blob: src + fetch で MSE に供給）が取得する
// fMP4 断片を、ディレクトリ単位で1つの「収集ストリーム」に束ねる。バイトは保持せず
// URL を再取得する（DASH/HLS と同方式）。DASH/HLS マニフェストが検出済みのタブでは
// 断片はそちらが扱うため収集しない。
//
// 既知の簡略化 / アップグレードパス:
//  - 対象は fMP4 断片(.m4s/.cmfv/.cmfa/.cmft)＋init のみ。TS・連番 .mp4・Smooth
//    Fragments(init 不在で単独結合不可)は対象外（別タスク）。
//  - グループキーはディレクトリ。1ディレクトリに複数レンディション/トラックが
//    混在するレイアウトは v1 で分離せず先頭 init を使うため出力が不正になりうる。
//    大半のパッケージャはレンディション別ディレクトリなのでその場合は正しく動く。
//  - ユーザーが再生し切った範囲の断片しか集まらない（ライブ録画と同じ本質的制約）。

const SEG_MIN = 6;   // これ未満の断片数では収集ストリームとして出さない（誤検知抑制）

const MEDIA_SEG_RE = /\.(m4s|cmfv|cmfa|cmft)(\?|#|$)/i;
const INIT_SEG_RE  = /(^|[/._-])init[^/]*\.(mp4|m4s|cmfv|cmfa|cmft)(\?|#|$)/i;

// tabId -> Map<dirname, group>
const _segStore = {};

/** URL のディレクトリ部（origin + パスの末尾ファイル名を除いた部分） */
function _segDirname(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/[^/]*$/, "");
  } catch (_) { return null; }
}

/** URL が fMP4 断片グループの対象か（メディア断片 or init 断片） */
function isSegmentUrl(url) {
  return MEDIA_SEG_RE.test(url) || INIT_SEG_RE.test(url);
}

/** タブに DASH/HLS マニフェスト item があるか（あれば断片はそちらが扱う） */
function _hasManifest(tabId) {
  const store = tabMediaStore[tabId];
  if (!store) return false;
  for (const it of store.values()) {
    const m = it.mimeHint || "";
    if (m.includes("dash+xml") || m.includes("mpegurl")) return true;
  }
  return false;
}

/**
 * 断片 URL を記録する。閾値に達したタブ（マニフェスト無し）では収集ストリーム
 * item を1件だけストアに表出する。
 */
function recordSegment(tabId, url, pageURL) {
  const dir = _segDirname(url);
  if (!dir) return;

  const groups = _segStore[tabId] ?? (_segStore[tabId] = new Map());
  let g = groups.get(dir);
  if (!g) {
    g = { dir, media: new Map(), init: null, pageURL: pageURL || "", firstSeen: Date.now(), storeItem: null };
    groups.set(dir, g);
  }

  if (INIT_SEG_RE.test(url)) {
    if (!g.init) g.init = url;
  } else {
    g.media.set(url, true);
  }

  if (g.storeItem) {
    g.storeItem.segmentCount = g.media.size;   // 表示カウントを更新
  } else if (g.media.size >= SEG_MIN && !_hasManifest(tabId)) {
    const stem = g.dir.replace(/\/$/, "").split("/").pop() || "stream";
    g.storeItem = {
      url:            "mvgroup:" + dir,
      groupKey:       dir,
      source:         "segment",
      tag:            /audio/i.test(dir) ? "audio" : "video",
      mimeHint:       "video/mp4",
      contentLength:  null,
      isSegmentGroup: true,
      segmentCount:   g.media.size,
      pageURL:        g.pageURL,
      pageTitle:      "",
      detectedAt:     g.firstSeen,
    };
    addToStore(tabId, g.storeItem);
  }
}

/**
 * ダウンロード用に、グループの順序付き URL を返す。
 * init を先頭に、メディア断片はファイル名末尾の数値で昇順ソートする。
 */
function getSegmentGroupUrls(tabId, groupKey) {
  const g = _segStore[tabId]?.get(groupKey);
  if (!g) return null;
  // ファイル名末尾の数値を断片インデックスとして使う（拡張子内の数字は除外）
  const lastNum = (u) => {
    const name = u.split(/[?#]/)[0].split("/").pop()
      .replace(/\.(m4s|cmfv|cmfa|cmft|mp4|ts)$/i, "");
    const m = name.match(/(\d+)(?!.*\d)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const media = [...g.media.keys()].sort((a, b) => lastNum(a) - lastNum(b));
  const stem = g.dir.replace(/\/$/, "").split("/").pop() || "stream";
  return { init: g.init, media, pageURL: g.pageURL, stem };
}

// node 単体テスト用（拡張機能コンテキストでは module 未定義なのでスキップ）
if (typeof module !== "undefined") module.exports = { isSegmentUrl, recordSegment, getSegmentGroupUrls };
