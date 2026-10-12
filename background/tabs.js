// background/tabs.js — MimicVault
// タブイベント（onRemoved/onUpdated）でのストア掃除・ツールバーアイコン動作

"use strict";

// ─── ツールバーアイコン: 固定幅パネルの開閉 ──────────────────────────────────
// Firefox 標準のサイドバーはユーザがドラッグで幅を変えられ、狭めると
// popup 用に作った固定幅前提のレイアウトが崩れてしまう。そのため
// 「content/sidePanel.js がページ上に重ねて描画する固定幅パネル」方式にし、
// 開閉状態は storage.local に保存してどのタブでも同じ開閉状態を保つ。

/** 開閉状態を保存し、全タブの content script に通知する。 */
async function setPanelOpen(open) {
  await browser.storage.local.set({ panelOpen: open });
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    browser.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL", open }).catch(() => {
      // content script 未注入のタブ（about: ページ等）は無視
    });
  }
}

// default_popup を外しているため、アイコンクリックで onClicked が発火する。
browser.browserAction.onClicked.addListener(async () => {
  const { panelOpen = false } = await browser.storage.local.get("panelOpen");
  setPanelOpen(!panelOpen);
});

// パネル内の「✕ 閉じる」ボタンから送られる
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "CLOSE_PANEL") setPanelOpen(false);
});

// ─── タブイベント ─────────────────────────────────────────────────────────────

browser.tabs.onRemoved.addListener((tabId) => {
  delete tabMediaStore[tabId];
  clearSegmentGroups(tabId);
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
    clearSegmentGroups(tabId);
    updateBadge(tabId, 0);
  }
});
