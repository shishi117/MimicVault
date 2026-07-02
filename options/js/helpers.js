// options/js/helpers.js — MimicVault
// 整形ヘルパー linesToArray/arrayToLines/showSaveStatus/updatePreview

"use strict";

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function linesToArray(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function arrayToLines(arr) {
  return Array.isArray(arr) ? arr.join("\n") : "";
}

function showSaveStatus(message, isError = false) {
  elIndicator.textContent = message;
  elIndicator.classList.toggle("error", isError);
  elIndicator.classList.add("visible");
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => elIndicator.classList.remove("visible"), 1400);
}

/** テンプレートプレビューを更新する */
function updatePreview() {
  if (!elPreview) return;
  const tmpl = elTemplate.value || "%title";
  const preview = tmpl.replace(/%title/g, "sample-video");
  elPreview.textContent = `例: ${preview}.mp4`;
}

