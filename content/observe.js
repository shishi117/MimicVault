// content/observe.js — MimicVault
// MutationObserver 監視と初回走査（最後に読み込む）

"use strict";

// ─── MutationObserver — 動的に追加された要素も監視 ───────────────────────────

let observerTimer = null;

const observer = new MutationObserver(() => {
  // DOM 変更が連続する場合はまとめて 300ms 後に処理する
  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    const found = collectMediaFromDOM();
    sendToBackground(found);
  }, 300);
});

const initial = collectMediaFromDOM();
sendToBackground(initial);

// 以降は DOM 変化を監視（動的ロードの動画に対応）
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
