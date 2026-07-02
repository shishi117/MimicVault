// popup/js/settings.js — MimicVault
// ユーザ設定ロードと優先バリアント選択 loadUserSettings/pickPreferredVariantIndex/parseHeight

"use strict";

async function loadUserSettings() {
  try {
    const stored = await browser.storage.local.get("ms_settings");
    userSettings = { hlsPreferred: "highest", filenameTemplate: "%title", ...(stored.ms_settings ?? {}) };
  } catch (_) { /* デフォルトのまま */ }
}

/**
 * バリアント一覧から設定の優先画質に一致するインデックスを返す。
 * 見つからなければ 0（最高画質）を返す。
 * バリアントは background 側で bandwidth 降順ソート済み。
 *
 * @param {Array<{resolution: string|null, bandwidth: number}>} variants
 */
function pickPreferredVariantIndex(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return -1;

  const pref = userSettings.hlsPreferred;
  if (!pref || pref === "highest") return 0;

  // "1080p" → 1080 を抽出して、resolution の height と一致するものを探す
  const targetHeight = parseInt(String(pref).replace(/\D/g, ""), 10);
  if (!Number.isFinite(targetHeight)) return 0;

  // 完全一致優先
  for (let i = 0; i < variants.length; i++) {
    const h = parseHeight(variants[i].resolution);
    if (h === targetHeight) return i;
  }
  // フォールバック: 最高画質
  return 0;
}

function parseHeight(resolution) {
  if (!resolution) return null;
  const m = String(resolution).match(/(\d+)x(\d+)/);
  return m ? parseInt(m[2], 10) : null;
}

