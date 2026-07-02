// popup/js/liveBanner.js — MimicVault
// ライブ録画バナー UI buildLiveRecordingBanner ほか

"use strict";

// ─── ライブ録画 UI（ステップ10） ──────────────────────────────────────────────

/**
 * ライブバナーを全面的に再構築する。
 * recording 状態のセッションが1件以上あれば表示、なければ非表示にする。
 */
function buildLiveRecordingBanner() {
  elLiveBanner.innerHTML = "";

  const activeSessions = [...liveRecordingStates.entries()]
    .filter(([, lrs]) => lrs.state === "recording");

  if (activeSessions.length === 0) {
    elLiveBanner.classList.add("hidden");
    return;
  }

  elLiveBanner.classList.remove("hidden");

  for (const [url, lrs] of activeSessions) {
    const item = document.createElement("div");
    item.className = "live-banner-item";

    // 点滅ドット
    const dot = document.createElement("span");
    dot.className = "live-dot";

    // ラベル（ファイル名ステム or URL）
    const label = document.createElement("span");
    label.className = "live-banner-label";
    label.textContent = lrs.stem || extractFilename(url);
    label.title = url;

    // 統計（セグメント数 / チャンク数）
    const stats = document.createElement("span");
    stats.className = "live-banner-stats";
    stats.dataset.url = url;
    stats.textContent = formatLiveStats(lrs);

    // 停止ボタン
    const stopBtn = document.createElement("button");
    stopBtn.className = "live-stop-btn";
    stopBtn.textContent = "■ 停止";
    stopBtn.addEventListener("click", () => stopLiveRecordingFromPopup(url));

    item.appendChild(dot);
    item.appendChild(label);
    item.appendChild(stats);
    item.appendChild(stopBtn);
    elLiveBanner.appendChild(item);
  }
}

/** ライブ統計テキストを生成 */
function formatLiveStats(lrs) {
  const segs   = lrs.totalSegments;
  const chunks = lrs.chunkIndex;
  if (chunks === 0) return `${segs} seg`;
  return `${segs} seg / ${chunks} ファイル`;
}

/**
 * URL で特定のバナー行の統計テキストだけを更新する。
 * バナー全体の再構築より軽い。
 */
function updateLiveBannerStats(url) {
  const statsEl = elLiveBanner.querySelector(`.live-banner-stats[data-url="${CSS.escape(url)}"]`);
  if (!statsEl) return;
  const lrs = liveRecordingStates.get(url);
  if (lrs) statsEl.textContent = formatLiveStats(lrs);
}

/**
 * バリアントリスト内の DL ボタンを取得し、ライブ状態を反映する。
 * バナーとは別に、アコーディオンが開いている場合のみ更新される。
 */
function updateLiveRecordingButton(url) {
  const btn = document.querySelector(`.hls-variants .dl-btn[data-url="${CSS.escape(url)}"]`);
  if (!btn) return;
  const lrs = liveRecordingStates.get(url);
  if (lrs) applyLiveRecordingButtonState(btn, lrs, url);
}

/**
 * バリアント DL ボタンをライブ録画状態に応じて更新する。
 *
 * state === "recording" : 「■ 停止（xx seg）」— クリックで停止
 * state === "stopped"   : 「✓ 録画停止」
 * state === "ended"     : 「✓ 録画完了」（ストリーム側が終了）
 *
 * @param {HTMLButtonElement} btn
 * @param {object}            lrs        - liveRecordingStates の値
 * @param {string}            variantUrl
 */
function applyLiveRecordingButtonState(btn, lrs, variantUrl) {
  btn.classList.remove(
    "dl-btn--downloading", "dl-btn--complete", "dl-btn--error", "dl-btn--live"
  );
  btn.disabled = false;
  // 既存の onclick を解除
  btn.onclick = null;

  switch (lrs.state) {
    case "recording":
      btn.classList.add("dl-btn--live");
      btn.textContent = `■ 停止 (${lrs.totalSegments}seg)`;
      btn.title = "クリックして録画を停止";
      btn.onclick = (e) => {
        e.stopPropagation();
        stopLiveRecordingFromPopup(variantUrl);
      };
      break;

    case "stopped":
      btn.classList.add("dl-btn--complete");
      btn.textContent = "✓ 録画停止";
      btn.disabled = true;
      showHlsTsNote(btn);
      break;

    case "ended":
      btn.classList.add("dl-btn--complete");
      btn.textContent = `✓ 録画完了 (${lrs.chunkIndex}ch)`;
      btn.disabled = true;
      showHlsTsNote(btn);
      break;
  }
}

/**
 * ポップアップの停止ボタンから呼ばれる。
 * STOP_LIVE_RECORDING を background に送信して録画を終了する。
 */
async function stopLiveRecordingFromPopup(url) {
  // 楽観的 UI 更新（レスポンスを待たず即反映）
  const lrs = liveRecordingStates.get(url);
  if (lrs) {
    lrs.state = "stopped";
    buildLiveRecordingBanner();
    updateLiveRecordingButton(url);
  }

  try {
    await browser.runtime.sendMessage({ type: "STOP_LIVE_RECORDING", url });
  } catch (_) {}
}

/**
 * ボタンには data-url 属性を付け、updateDownloadButton() で参照できるようにする。
 */
