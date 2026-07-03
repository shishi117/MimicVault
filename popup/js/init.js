// popup/js/init.js — MimicVault
// 初期化 init/startDownloadAll と起動呼び出し（最後に読み込む）

"use strict";

// ─── メイン ───────────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  // ステップ18: 設定を先に読み込む（HLS アコーディオン表示時に使う）
  await loadUserSettings();

  try {
    const res = await browser.runtime.sendMessage({
      type: "GET_MEDIA_LIST",
      tabId: tab.id,
    });
    allItems = res?.items ?? [];
  } catch (_) {
    allItems = [];
  }

  // ── ステップ10: 進行中のライブセッションを復元してバナーに表示 ──────────────
  try {
    const liveRes = await browser.runtime.sendMessage({ type: "GET_LIVE_SESSIONS" });
    for (const s of liveRes?.sessions ?? []) {
      liveRecordingStates.set(s.url, {
        state:         s.state,
        totalSegments: s.totalSegments,
        chunkIndex:    s.chunkIndex,
        stem:          s.stem,
      });
    }
  } catch (_) {}
  buildLiveRecordingBanner();

  // イベント登録
  filterTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      filterTabs.forEach(b => b.classList.toggle("active", b === btn));
      renderList();
    });
  });

  elSort.addEventListener("change", renderList);

  elClearBtn.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "CLEAR_MEDIA_LIST", tabId: currentTabId });
    allItems = [];
    renderList();
  });

  // ステップ18: 設定ボタン → options ページを開く
  if (elSettingsBtn) {
    elSettingsBtn.addEventListener("click", () => {
      browser.runtime.openOptionsPage().catch(err => {
        console.error("[popup] openOptionsPage failed:", err);
      });
      // ポップアップは options ページを開いた後すぐ閉じて UX をスムーズに
      window.close();
    });
  }

  // v0.18.0: 全件DLボタン
  if (elDlAllBtn) {
    elDlAllBtn.addEventListener("click", () => startDownloadAll());
  }

  renderList();
  requestThumbnails(currentTabId);
  loadMediaMeta();  // DASH/HLS の方式・長さ・結合後サイズを先読みして再描画
}

/**
 * 検出済みの DASH/HLS アイテムのメタ情報（方式・長さ・結合後サイズ）を
 * background に並列で問い合わせ、mediaMetaStore に格納してリストを再描画する。
 * 直接ファイル（mp4 等）は長さ不明のため対象外。
 * 既知の簡略化: 全件 settle 後に一括再描画（通常ページ内のストリームは1本程度）。
 */
async function loadMediaMeta() {
  const streams = allItems.filter(it => !it.isSegmentGroup && mediaMethodLabel(it) !== "直接");
  if (streams.length === 0) return;

  await Promise.allSettled(streams.map(async (item) => {
    const meta = await browser.runtime.sendMessage({
      type:     "GET_MEDIA_META",
      url:      item.url,
      mimeHint: item.mimeHint ?? "",
      pageURL:  item.pageURL ?? "",
    });
    if (meta?.ok) mediaMetaStore.set(item.url, meta);
  }));

  renderList();
}

/**
 * 検出された全アイテムを DOWNLOAD_MEDIA_ALL で background に一括送信する。
 * HLS / DASH アイテムは直接 DL（URL そのもの）になるため、
 * ストリーム系の結合は別途必要になることをトーストで通知する。
 */
async function startDownloadAll() {
  if (allItems.length === 0) return;

  elDlAllBtn.disabled = true;
  elDlAllBtn.textContent = "…";

  try {
    const res = await browser.runtime.sendMessage({
      type:  "DOWNLOAD_MEDIA_ALL",
      tabId: currentTabId,
    });
    const dl         = res?.results ?? [];
    const failed     = dl.filter(r => !r.ok).length;
    const ok         = dl.length - failed;
    const converting = res?.converting ?? 0;
    const skipped    = res?.skipped ?? [];

    const parts = [];
    if (ok > 0)         parts.push(`${ok}件DL開始`);
    if (converting > 0) parts.push(`${converting}件を変換開始`);
    if (failed > 0)     parts.push(`${failed}件失敗`);
    if (skipped.length) {
      const reasons = [...new Set(skipped.map(s => s.reason))];
      parts.push(`${skipped.length}件スキップ(${reasons.join("・")})`);
    }
    showToast(parts.length ? parts.join(" / ") : "対象がありません");
  } catch (err) {
    showToast("全件DL失敗: " + err.message);
  }

  elDlAllBtn.disabled = false;
  elDlAllBtn.textContent = "▶ 全DL";
}

// ─── 起動 ────────────────────────────────────────────────────────────────────
init();
