// options/js/settings.js — MimicVault
// 設定の読み込み/保存 loadSettings/applyToUI/collectFromUI/saveNow

"use strict";

// ─── 読み込み ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const saved  = stored[STORAGE_KEY] ?? {};
    applyToUI({ ...DEFAULTS, ...saved });
  } catch (err) {
    console.error("[options] failed to load settings:", err);
    applyToUI(DEFAULTS);
  }
}

function applyToUI(s) {
  elMinSize.value   = Number.isFinite(s.minSizeKB) ? s.minSizeKB : DEFAULTS.minSizeKB;
  elBlacklist.value = arrayToLines(s.blacklist);
  elWhitelist.value = arrayToLines(s.whitelist);
  elHlsPref.value   = ["highest", "1080p", "720p", "480p"].includes(s.hlsPreferred)
    ? s.hlsPreferred : DEFAULTS.hlsPreferred;
  // filenameTemplate（旧 filenamePrefix との互換: 旧設定の prefix 値は読み捨て）
  const tmpl = typeof s.filenameTemplate === "string"
    ? s.filenameTemplate
    : (typeof s.filenamePrefix === "string" && s.filenamePrefix ? s.filenamePrefix + "%title" : DEFAULTS.filenameTemplate);
  elTemplate.value    = tmpl;
  elCompanion.checked = s.companionEnabled !== false;
  updatePreview();
}

// ─── 保存 ─────────────────────────────────────────────────────────────────────

function collectFromUI() {
  const parsedMin = parseInt(elMinSize.value, 10);
  return {
    minSizeKB:        Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : DEFAULTS.minSizeKB,
    blacklist:        linesToArray(elBlacklist.value),
    whitelist:        linesToArray(elWhitelist.value),
    hlsPreferred:     elHlsPref.value,
    filenameTemplate: elTemplate.value || DEFAULTS.filenameTemplate,
    companionEnabled: elCompanion.checked,
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow().catch(() => {}), 250);
}

async function saveNow() {
  const settings = collectFromUI();
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: settings });
    showSaveStatus("✓ 保存しました");
  } catch (err) {
    console.error("[options] save failed:", err);
    showSaveStatus("保存に失敗しました", true);
  }
}

