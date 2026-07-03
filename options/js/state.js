// options/js/state.js — MimicVault
// 設定スキーマ DEFAULTS/STORAGE_KEY と DOM 参照（最初に読み込む）

"use strict";

const DEFAULTS = Object.freeze({
  minSizeKB:           1,
  blacklist:           [],
  whitelist:           [],
  hlsPreferred:        "highest",
  filenameTemplate:    "%title",
  companionEnabled:    true,
  popupMinDurationSec: 10,   // ポップアップ: 再生時間がこの秒数未満なら非表示
  popupMinSizeKB:      50,   // ポップアップ: 長さ不明時、サイズがこのKB未満なら非表示
});

const STORAGE_KEY = "ms_settings";

// ─── DOM 参照 ─────────────────────────────────────────────────────────────────
const elMinSize    = document.getElementById("min-size");
const elBlacklist  = document.getElementById("blacklist");
const elWhitelist  = document.getElementById("whitelist");
const elHlsPref    = document.getElementById("hls-preferred");
const elTemplate   = document.getElementById("filename-template");
const elCompanion  = document.getElementById("companion-enabled");
const elPopupMinDuration = document.getElementById("popup-min-duration");
const elPopupMinSize     = document.getElementById("popup-min-size");
const elResetBtn   = document.getElementById("reset-btn");
const elIndicator  = document.getElementById("save-indicator");
const elPreview    = document.getElementById("template-preview");

let saveTimer = null;
let indicatorTimer = null;
