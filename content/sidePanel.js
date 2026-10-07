// content/sidePanel.js — MimicVault
// ページ上に重ねて表示する固定幅パネル（Firefox 標準サイドバーの代わり）
//
// 標準サイドバーはユーザがドラッグで幅を変えられ、狭めると popup 用に作った
// 固定幅前提のレイアウトが崩れる。かわりにこの content script が各ページの
// 右端に固定幅の iframe（中身は popup/popup.html と同じ）を重ねて表示する。
// 開閉状態は storage.local で共有し、どのタブを見ても同じ開閉状態になる。

"use strict";

const PANEL_WIDTH = "380px";
const PANEL_ID     = "mimicvault-side-panel";

let panelEl = null;

/** パネル（iframe を包む固定要素）を作る。初回表示時にのみ呼ぶ。 */
function createPanel() {
  const wrap = document.createElement("div");
  wrap.id = PANEL_ID;
  wrap.style.cssText = [
    "all: initial",
    "position: fixed",
    "top: 0",
    "right: 0",
    "width: " + PANEL_WIDTH,
    "height: 100vh",
    "z-index: 2147483647", // ページ側の重なりに負けないよう最大値
    "box-shadow: -2px 0 12px rgba(0,0,0,.25)",
  ].join(";");

  const iframe = document.createElement("iframe");
  iframe.src = browser.runtime.getURL("popup/popup.html");
  iframe.style.cssText = "display:block; width:100%; height:100%; border:none;";

  wrap.appendChild(iframe);
  document.documentElement.appendChild(wrap);
  return wrap;
}

function setPanelOpen(open) {
  if (open) {
    if (!panelEl) panelEl = createPanel();
    panelEl.style.display = "block";
  } else if (panelEl) {
    panelEl.style.display = "none";
  }
}

// ── 初期状態の復元（ページ読み込み・再読み込みのたびに実行される） ─────────────
browser.storage.local.get("panelOpen").then(({ panelOpen }) => {
  if (panelOpen) setPanelOpen(true);
});

// ── ツールバーアイコンや、パネル内の閉じるボタンからの開閉通知 ─────────────────
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "TOGGLE_PANEL") {
    setPanelOpen(message.open);
  }
});
