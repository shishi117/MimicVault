// background/settings.js — MimicVault
// 設定キャッシュ loadSettings/getSettings と storage.onChanged

"use strict";

// ─── 設定（ステップ18） ───────────────────────────────────────────────────────
/**
 * 設定は options ページから browser.storage.local に保存される。
 * background からは同期的に参照できるようキャッシュを保持し、
 * storage.onChanged で更新する。
 *
 * スキーマは options/options.js の DEFAULTS と一致させる。
 */

const SETTINGS_STORAGE_KEY = "ms_settings";

const SETTINGS_DEFAULTS = Object.freeze({
  minSizeKB:           1,
  blacklist:           [],
  whitelist:           [],
  hlsPreferred:        "highest",
  filenameTemplate:    "%title",
  companionEnabled:    true,
  popupMinDurationSec: 10,   // ポップアップ表示フィルタ（popup 側で使用）
  popupMinSizeKB:      50,
});

/** メモリ上のキャッシュ。初期化完了までデフォルトを返す */
let settingsCache = { ...SETTINGS_DEFAULTS };

/** 起動時ロード */
async function loadSettings() {
  try {
    const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
    const saved  = stored[SETTINGS_STORAGE_KEY] ?? {};
    settingsCache = { ...SETTINGS_DEFAULTS, ...saved };
  } catch (err) {
    console.warn("[ms] failed to load settings:", err);
    settingsCache = { ...SETTINGS_DEFAULTS };
  }
}

function getSettings() { return settingsCache; }

// options ページからの変更を反映
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_STORAGE_KEY]) return;
  const prevEnabled = settingsCache.companionEnabled;
  const newVal = changes[SETTINGS_STORAGE_KEY].newValue ?? {};
  settingsCache = { ...SETTINGS_DEFAULTS, ...newVal };

  // companion 機能 ON/OFF が切り替わった場合の処理
  const newEnabled = settingsCache.companionEnabled !== false;
  if (prevEnabled !== newEnabled && typeof companionPort !== "undefined") {
    if (!newEnabled && companionPort) {
      // 無効化 → 切断
      try { companionPort.disconnect(); } catch (_) {}
      companionPort = null;
      companionStatus = "disabled";
      broadcastCompanionStatus();
    } else if (newEnabled && !companionPort) {
      // 有効化 → 再接続を試みる
      connectCompanion();
    }
  }
});

// 背景スクリプト起動時に即座にロード開始（非永続背景のため fire-and-forget）
loadSettings();

