// options/js/main.js — MimicVault
// イベント登録と初期化 bindEvents（最後に読み込む）

"use strict";

// ─── イベント登録 ─────────────────────────────────────────────────────────────

function bindEvents() {
  [elMinSize, elBlacklist, elWhitelist, elPopupMinDuration, elPopupMinSize]
    .forEach(el => el.addEventListener("input", scheduleSave));
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
