// popup/js/dashDownload.js — MimicVault
// DASH トラックダウンロード startDashTrackDownload ほか

"use strict";

// ─── DASH ダウンロード処理（ステップ12） ──────────────────────────────────────

/**
 * DASH トラックのセグメントダウンロードを開始する。
 * background に DOWNLOAD_DASH_TRACK を送り、完了までボタン状態を管理する。
 *
 * @param {object}           item      - 元の MPD アイテム（url / pageURL を参照）
 * @param {object}           rep       - Representation オブジェクト（segInfo 含む）
 * @param {"video"|"audio"}  trackType
 * @param {HTMLButtonElement} btn
 */
async function startDashTrackDownload(item, rep, trackType, btn) {
  const dashKey = `${item.url}::${rep.id}`;

  // 二重起動防止
  if (dashDownloadStates.get(dashKey)?.state === "fetching") return;

  // 状態初期化してすぐ UI 更新
  const dds = { state: "fetching", current: 0, total: 0 };
  dashDownloadStates.set(dashKey, dds);
  applyDashDownloadButtonState(btn, dds);

  // mpdDuration は toggleDashAccordion 時に保存済み
  const mpdDuration = mpdDurationStore.get(item.url) ?? 0;

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:        "DOWNLOAD_DASH_TRACK",
      rep,
      mpdUrl:      item.url,
      mpdDuration,
      trackType,
      pageURL:     item.pageURL ?? "",
    });
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  if (result?.ok) {
    dds.state = "complete";
    applyDashDownloadButtonState(btn, dds);
    showDashSeparateNote(btn, trackType);
  } else {
    dds.state = "error";
    dds.error = result?.error ?? "unknown";
    applyDashDownloadButtonState(btn, dds);
  }
}

/**
 * data-dash-key 属性をもつ DL ボタンを検索して最新状態を反映する。
 * DASH_DOWNLOAD_PROGRESS コールバックから呼ばれる。
 *
 * @param {string} key - `${mpdUrl}::${repId}` 形式のキー
 */
function updateDashDownloadButton(key) {
  const btn = document.querySelector(
    `.dl-btn[data-dash-key="${CSS.escape(key)}"]`
  );
  if (!btn) return;
  applyDashDownloadButtonState(btn, dashDownloadStates.get(key));
}

/**
 * DASH ダウンロード状態に応じてボタンのテキスト・クラスを更新する。
 *
 * fetching : "x / y" または "…"（disabled）
 * complete : "✓ 完了"（disabled）
 * error    : "✗ エラー種別"（再クリック可能）
 *
 * @param {HTMLButtonElement} btn
 * @param {object|undefined}  dds - dashDownloadStates の値
 */
function applyDashDownloadButtonState(btn, dds) {
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");

  if (!dds) {
    // 未着手 — disabled 状態（segInfo なし）はそのまま維持
    if (!btn.disabled) btn.textContent = "↓ DL";
    return;
  }

  switch (dds.state) {
    case "fetching":
      btn.classList.add("dl-btn--downloading");
      btn.disabled    = true;
      btn.textContent = dds.total > 0
        ? `${dds.current} / ${dds.total}`
        : "…";
      break;

    case "complete":
      btn.classList.add("dl-btn--complete");
      btn.disabled    = true;
      btn.textContent = "✓ 完了";
      break;

    case "error": {
      const msg = dashDownloadErrorMessage(dds.error);
      btn.classList.add("dl-btn--error");
      btn.disabled    = false;
      btn.textContent = `✗ ${msg}`;
      btn.title       = msg;
      break;
    }

    default:
      if (!btn.disabled) btn.textContent = "↓ DL";
  }
}

