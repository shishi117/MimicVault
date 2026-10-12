// background/mediaStore.js — MimicVault
// タブ別メディアストアとバッジ制御 getStore/addToStore/updateBadge

"use strict";

// ─── タブ別メディアストア ─────────────────────────────────────────────────────

const tabMediaStore = {};

function getStore(tabId) {
  if (!tabMediaStore[tabId]) tabMediaStore[tabId] = new Map();
  return tabMediaStore[tabId];
}

function isHlsOrDashItem(item) {
  const mime = item.mimeHint ?? "";
  return /\.m3u8(\?|#|$)/i.test(item.url) || mime.includes("mpegurl") ||
         /\.mpd(\?|#|$)/i.test(item.url)  || mime.includes("dash+xml") || mime.includes("mpd");
}

/**
 * HLS/DASH ではない、通常の progressive 動画/音声ファイル（mp4直リンク等）か。
 * 単体ファイルの直接DLは downloadDirectRanged.js が再生時と同じ Range 分割
 * リクエストで取得するため、ここでは一覧表示の対象として受け入れる。
 */
function isPlainMediaItem(item) {
  const mime = item.mimeHint ?? "";
  return MEDIA_MIME_RE.test(mime) || MEDIA_URL_RE.test(item.url);
}

function addToStore(tabId, item) {
  // MSS(.ism/Manifest) は dash+xml として扱い、既存 DASH 経路へ吸収する。
  // 実際の DASH URL 解決は fetchDashInfo が候補を試して行う（viaMss はラベル用）。
  if (isMssUrl(item.url, item.mimeHint)) {
    item.mimeHint = "application/dash+xml";
    item.viaMss   = true;
  }

  if (!item.isSegmentGroup && !isHlsOrDashItem(item) && !isPlainMediaItem(item)) return false;

  const store = getStore(tabId);
  if (store.has(item.url)) return false;
  store.set(item.url, item);
  updateBadge(tabId, store.size);

  // パネル（content/sidePanel.js が注入する iframe）は開いた瞬間に一覧を1回
  // 取得するだけで、その後の新規検出を自動では拾わない。バッジは addToStore の
  // たびに更新されるのに、パネルを開いた直後に検出が間に合わなかった場合や、
  // 開きっぱなしで検出が進んだ場合に「バッジは増えるのに一覧は0件のまま」に
  // なるため、検出の都度タブへ通知する（content script 経由で iframe に転送）。
  browser.tabs?.sendMessage(tabId, { type: "MEDIA_LIST_UPDATED" })?.catch(() => {});

  return true;
}

// ─── バッジ制御 ───────────────────────────────────────────────────────────────

function updateBadge(tabId, count) {
  const text = count > 0 ? String(count) : "";
  browser.browserAction.setBadgeText({ text, tabId });
  browser.browserAction.setBadgeBackgroundColor({ color: "#5f4dbc", tabId });
}

if (typeof module !== "undefined") module.exports = { getStore, addToStore, isHlsOrDashItem };

