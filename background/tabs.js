// background/tabs.js — MimicVault
// タブイベント（onRemoved/onUpdated）でのストア掃除

"use strict";

// ─── タブイベント ─────────────────────────────────────────────────────────────

browser.tabs.onRemoved.addListener((tabId) => {
  delete tabMediaStore[tabId];
  // このタブに紐づくライブ録画セッションを停止（放置するとポーリングとDLが継続する）。
  // stopLiveRecording が残バッファを最終チャンクとしてフラッシュするのでデータは失われない。
  const urls = [...liveRecordingSessions.values()]
    .filter(s => s.tabId === tabId)
    .map(s => s.url);
  for (const url of urls) stopLiveRecording(url).catch(() => {});
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    delete tabMediaStore[tabId];
    updateBadge(tabId, 0);
  }
});
