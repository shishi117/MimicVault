/**
 * options.js  (v0.18.0)
 *
 * 設定スキーマ:
 *   minSizeKB          : number   — 最小ファイルサイズ（KB）。0 なら無制限
 *   blacklist          : string[] — ドメインブラックリスト（ワイルドカード可）
 *   whitelist          : string[] — ドメインホワイトリスト（ワイルドカード可）
 *   hlsPreferred       : "highest" | "1080p" | "720p" | "480p"
 *   filenameTemplate   : string   — ファイル名テンプレート（%title 等）
 *   companionEnabled   : boolean  — Companion 機能の有効/無効
 */

"use strict";

const DEFAULTS = Object.freeze({
  minSizeKB:        1,
  blacklist:        [],
  whitelist:        [],
  hlsPreferred:     "highest",
  filenameTemplate: "%title",
  companionEnabled: true,
});

const STORAGE_KEY = "ms_settings";

// ─── DOM 参照 ─────────────────────────────────────────────────────────────────
const elMinSize    = document.getElementById("min-size");
const elBlacklist  = document.getElementById("blacklist");
const elWhitelist  = document.getElementById("whitelist");
const elHlsPref    = document.getElementById("hls-preferred");
const elTemplate   = document.getElementById("filename-template");
const elCompanion  = document.getElementById("companion-enabled");
const elResetBtn   = document.getElementById("reset-btn");
const elIndicator  = document.getElementById("save-indicator");
const elPreview    = document.getElementById("template-preview");

let saveTimer = null;
let indicatorTimer = null;

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

// ─── イベント登録 ─────────────────────────────────────────────────────────────

function bindEvents() {
  [elMinSize, elBlacklist, elWhitelist].forEach(el => el.addEventListener("input", scheduleSave));
  elHlsPref.addEventListener("change", scheduleSave);
  elCompanion.addEventListener("change", scheduleSave);

  elTemplate.addEventListener("input", () => {
    updatePreview();
    scheduleSave();
  });

  elResetBtn.addEventListener("click", async () => {
    if (!confirm("すべての設定を初期状態に戻します。よろしいですか？")) return;
    try {
      await browser.storage.local.remove(STORAGE_KEY);
      applyToUI(DEFAULTS);
      showSaveStatus("✓ リセットしました");
    } catch (err) {
      showSaveStatus("リセットに失敗しました", true);
    }
  });
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  applyToUI({ ...DEFAULTS, ...(changes[STORAGE_KEY].newValue ?? {}) });
});

loadSettings().then(bindEvents);
