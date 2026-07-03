// popup/js/utils.js — MimicVault
// 汎用ユーティリティ showToast/makeChip/extract*/formatDuration/formatSize

"use strict";

// ─── ユーティリティ ───────────────────────────────────────────────────────────

/**
 * 画面下部に短時間トースト通知を表示する。
 * @param {string} msg
 */
function showToast(msg) {
  let toast = document.getElementById("ms-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "ms-toast";
    toast.style.cssText = [
      "position:fixed;bottom:12px;left:50%;transform:translateX(-50%)",
      "background:#333;color:#fff;font-size:12px;padding:6px 14px",
      "border-radius:4px;z-index:9999;pointer-events:none;opacity:0",
      "transition:opacity .2s;max-width:90%;text-align:center",
    ].join(";");
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 2500);
}

function makeChip(text) {
  const span = document.createElement("span");
  span.className = "meta-chip";
  span.textContent = text;
  return span;
}

/** URL からドメイン部分を取得 */
function extractDomain(url) {
  try { return new URL(url).hostname; }
  catch (_) { return ""; }
}

/** URL からファイル名（パスの末尾）を取得 */
function extractFilename(url) {
  try {
    const path = new URL(url).pathname;
    const name = path.split("/").filter(Boolean).pop() ?? "";
    return name || url;
  } catch (_) {
    return url;
  }
}

/** 秒数を M:SS / H:MM:SS 形式に変換 */
function formatDuration(sec) {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** バイト数を人間が読みやすい文字列に変換 */
function formatSize(bytes) {
  if (bytes == null) return "不明";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

