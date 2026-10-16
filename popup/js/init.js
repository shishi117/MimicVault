// popup/js/init.js — MimicVault
// 初期化 init と起動呼び出し（最後に読み込む）

"use strict";

// ─── メイン ───────────────────────────────────────────────────────────────────
/**
 * このパネルは content script（content/sidePanel.js）がページごとに埋め込む
 * iframe の中身であり、1タブにつき1インスタンスが存在する。そのため
 * ポップアップ/サイドバー時代と違い「アクティブなタブ」を自分で探す必要はなく、
 * 自分が埋め込まれているタブ＝表示対象のタブで固定（ページを閉じたり
 * 再読み込みしたりすれば iframe ごと作り直される）。
 */
async function init() {
  // イベント登録（一度だけでよいもの）
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
      // options ページを開いたらこのパネルは閉じて UX をスムーズに
      browser.runtime.sendMessage({ type: "CLOSE_PANEL" }).catch(() => {});
    });
  }

  // ページに重ねて表示する固定幅パネルを閉じる
  if (elClosePanelBtn) {
    elClosePanelBtn.addEventListener("click", () => {
      browser.runtime.sendMessage({ type: "CLOSE_PANEL" }).catch(() => {});
    });
  }

  // ブックマーク一括DLパネルの開閉
  if (elBookmarkBtn) {
    elBookmarkBtn.addEventListener("click", () => toggleBookmarkPanel());
  }
  initBookmarkPanel();

  // ステップ18: 設定を先に読み込む（HLS 画質一覧表示時に使う）
  await loadUserSettings();

  await loadActiveTab();
}

/**
 * 自分が埋め込まれているタブの検出済みメディア一覧・ライブ録画状態を
 * 読み込んで表示する。
 */
async function loadActiveTab() {
  // iframe 自身は browser.tabs.query({currentWindow:true}) 等の「現在の
  // ウィンドウ／タブ」解決に乗らない（ページに埋め込まれた子フレームのため）
  // ので、background にメッセージを送って sender.tab から自分のタブIDを
  // 教えてもらう。
  let tabId;
  try {
    const res = await browser.runtime.sendMessage({ type: "GET_MY_TAB_ID" });
    tabId = res?.tabId;
  } catch (_) {
    tabId = null;
  }
  if (tabId == null) return;
  currentTabId = tabId;

  try {
    const res = await browser.runtime.sendMessage({
      type: "GET_MEDIA_LIST",
      tabId,
    });
    allItems = res?.items ?? [];
  } catch (_) {
    allItems = [];
  }

  // ── ステップ10: 進行中のライブセッションを復元してバナーに表示 ──────────────
  liveRecordingStates.clear();
  try {
    const liveRes = await browser.runtime.sendMessage({ type: "GET_LIVE_SESSIONS" });
    for (const s of liveRes?.sessions ?? []) {
      liveRecordingStates.set(s.url, {
        state:         s.state,
        totalSegments: s.totalSegments,
        chunkIndex:    s.chunkIndex,
        stem:          s.stem,
        filename:      s.filename,
      });
    }
  } catch (_) {}
  buildLiveRecordingBanner();

  renderList();
  requestThumbnails(currentTabId);
  loadMediaMeta();  // DASH/HLS の方式・長さ・結合後サイズを先読みして再描画
}

/**
 * 検出済みの DASH/HLS アイテムのメタ情報（方式・長さ・結合後サイズ）を
 * background に並列で問い合わせ、mediaMetaStore に格納してリストを再描画する。
 * 直接ファイル（mp4 等、ラベル「mp4分割」）は長さ不明のため対象外。
 * 既知の簡略化: 全件 settle 後に一括再描画（通常ページ内のストリームは1本程度）。
 */
async function loadMediaMeta() {
  const streams = allItems.filter(it => !it.isSegmentGroup && mediaMethodLabel(it) !== "mp4分割");
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

// ─── 起動 ────────────────────────────────────────────────────────────────────
init();
