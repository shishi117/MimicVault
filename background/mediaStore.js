// background/mediaStore.js — MimicVault
// タブ別メディアストアとバッジ制御 getStore/addToStore/updateBadge

"use strict";

// ─── タブ別メディアストア ─────────────────────────────────────────────────────

const tabMediaStore = {};

function getStore(tabId) {
  if (!tabMediaStore[tabId]) tabMediaStore[tabId] = new Map();
  return tabMediaStore[tabId];
}

/**
 * 直接DL機能は廃止。HLS/DASH(MSS含む)/収集ストリーム以外の単体ファイル
 * （通常の mp4 直リンクや、m3u8 の無い単独 .ts 等）は検出・一覧表示もしない。
 */
function isHlsOrDashItem(item) {
  const mime = item.mimeHint ?? "";
  return /\.m3u8(\?|#|$)/i.test(item.url) || mime.includes("mpegurl") ||
         /\.mpd(\?|#|$)/i.test(item.url)  || mime.includes("dash+xml") || mime.includes("mpd");
}

function addToStore(tabId, item) {
  // MSS(.ism/Manifest) は dash+xml として扱い、既存 DASH 経路へ吸収する。
  // 実際の DASH URL 解決は fetchDashInfo が候補を試して行う（viaMss はラベル用）。
  if (isMssUrl(item.url, item.mimeHint)) {
    item.mimeHint = "application/dash+xml";
    item.viaMss   = true;
  }

  if (!item.isSegmentGroup && !isHlsOrDashItem(item)) return false;

  const store = getStore(tabId);
  if (store.has(item.url)) return false;
  store.set(item.url, item);
  updateBadge(tabId, store.size);
  return true;
}

// ─── バッジ制御 ───────────────────────────────────────────────────────────────

function updateBadge(tabId, count) {
  const text = count > 0 ? String(count) : "";
  browser.browserAction.setBadgeText({ text, tabId });
  browser.browserAction.setBadgeBackgroundColor({ color: "#5f4dbc", tabId });
}

if (typeof module !== "undefined") module.exports = { getStore, addToStore, isHlsOrDashItem };

