// popup/js/companionIndicator.js — MimicVault
// Companion 接続インジケータ updateCompanionIndicator

"use strict";

// ─── Companion 状態管理（ステップ15/16） ─────────────────────────────────────

/**
 * companion の接続状態を UI に反映する。
 *
 * @param {"connected"|"disconnected"|"error"} status
 */
function updateCompanionIndicator(status) {
  if (!elCompanionIndicator) return;

  // クラスをすべてリセット
  elCompanionIndicator.classList.remove(
    "companion-connected",
    "companion-disconnected",
    "companion-error"
  );

  switch (status) {
    case "connected":
      elCompanionIndicator.classList.add("companion-connected");
      elCompanionIndicator.title = "Companion 接続済み — FFmpeg 変換が有効です";
      break;
    case "error":
      elCompanionIndicator.classList.add("companion-error");
      elCompanionIndicator.title = "Companion エラー — クリックして再接続";
      break;
    case "disabled":
      // ステップ18: 設定で無効化されている場合
      elCompanionIndicator.classList.add("companion-disconnected");
      elCompanionIndicator.title = "Companion は設定で無効化されています（クリックで再接続試行）";
      break;
    default: // "disconnected"
      elCompanionIndicator.classList.add("companion-disconnected");
      elCompanionIndicator.title = "Companion 未接続 — クリックして再接続";
  }
}

// 起動時に background から現在の companion 状態を取得
browser.runtime.sendMessage({ type: "GET_COMPANION_STATUS" })
  .then(res => updateCompanionIndicator(res?.status ?? "disconnected"))
  .catch(() => updateCompanionIndicator("disconnected"));

// インジケータをクリックしたら再接続を試みる
if (elCompanionIndicator) {
  elCompanionIndicator.addEventListener("click", () => {
    elCompanionIndicator.title = "接続中...";
    browser.runtime.sendMessage({ type: "CONNECT_COMPANION" })
      .then(res => updateCompanionIndicator(res?.status ?? "disconnected"))
      .catch(() => updateCompanionIndicator("error"));
  });
}

