// background/mediaStore.js — MimicVault
// タブ別メディアストアとバッジ制御 getStore/addToStore/updateBadge

"use strict";

// ─── タブ別メディアストア ─────────────────────────────────────────────────────

const tabMediaStore = {};

function getStore(tabId) {
  if (!tabMediaStore[tabId]) tabMediaStore[tabId] = new Map();
  return tabMediaStore[tabId];
}

function addToStore(tabId, item) {
  // MSS(.ism/Manifest) は dash+xml として扱い、既存 DASH 経路へ吸収する。
  // 実際の DASH URL 解決は fetchDashInfo が候補を試して行う（viaMss はラベル用）。
  if (isMssUrl(item.url, item.mimeHint)) {
    item.mimeHint = "application/dash+xml";
    item.viaMss   = true;
  }

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

