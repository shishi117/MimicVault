// popup/js/dashMux.js — MimicVault
// DASH mux 処理 startDashMux/formatBandwidth ほか

"use strict";

// ─── DASH mux（v0.18.0） ──────────────────────────────────────────────────────

/**
 * DOWNLOAD_DASH_MUX を background に送り、mux を開始する。
 */
async function startDashMux(item, videoRep, audioRep, btn) {
  if (dashMuxStates.get(item.url)?.state === "fetching") return;

  if (!dashMuxMeta.has(item.url)) {
    dashMuxMeta.set(item.url, { item, videoRep, audioRep, detectedAt: Date.now() });
  }

  const mds = { state: "fetching", phase: "video", current: 0, total: 0 };
  dashMuxStates.set(item.url, mds);
  applyDashMuxButtonState(btn, mds);

  const mpdDuration = mpdDurationStore.get(item.url) ?? 0;

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:        "DOWNLOAD_DASH_MUX",
      videoRep,
      audioRep,
      mpdUrl:      item.url,
      mpdDuration,
      pageURL:     item.pageURL ?? "",
    });
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  if (result?.ok) {
    mds.state = "complete";
    mds.muxed = result.muxed ?? false;
  } else {
    mds.state = "error";
    mds.error = result?.error ?? "unknown";
  }
  applyDashMuxButtonState(btn, mds);
}

/** data-mpd-url をもつ mux ボタンを探して状態を更新する */
function updateDashMuxButton(mpdUrl) {
  const btn = document.querySelector(`.dash-mux-btn[data-mpd-url="${CSS.escape(mpdUrl)}"]`);
  if (btn) applyDashMuxButtonState(btn, dashMuxStates.get(mpdUrl));
}

/** DASH mux ボタンの表示を状態に合わせて更新する */
function applyDashMuxButtonState(btn, mds) {
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");
  btn.disabled = false;

  if (!mds) {
    btn.textContent = "⊕ mux DL";
    return;
  }

  switch (mds.state) {
    case "fetching": {
      btn.classList.add("dl-btn--downloading");
      btn.disabled = true;
      const phaseLabel = { video: "映像取得", audio: "音声取得", muxing: "mux中" }[mds.phase] ?? "処理中";
      btn.textContent = mds.total > 0
        ? `${phaseLabel} ${mds.current}/${mds.total}`
        : `${phaseLabel}…`;
      break;
    }
    case "complete":
      btn.classList.add("dl-btn--complete");
      btn.disabled = true;
      btn.textContent = mds.muxed ? "✓ mux完了 (.mp4)" : "✓ 別ファイルDL完了";
      break;
    case "error":
      btn.classList.add("dl-btn--error");
      btn.textContent = `✗ ${mds.error ?? "エラー"}`;
      break;
    default:
      btn.textContent = "⊕ mux DL";
  }
}

/** DASH ダウンロードエラーコードを日本語に変換 */
function dashDownloadErrorMessage(error) {
  switch (error) {
    case "no_segments": return "セグメントなし";
    default:            return error ?? "不明なエラー";
  }
}

/**
 * ダウンロード完了後にボタンの下へ「映像のみ / 音声のみ」の注記を表示する。
 * DASH の映像・音声は別ファイルで保存されるため VLC 等で結合が必要。
 *
 * @param {HTMLButtonElement} btn
 * @param {"video"|"audio"}   trackType
 */
function showDashSeparateNote(btn, trackType) {
  if (btn.parentElement?.querySelector(".dash-dl-note")) return;
  const note = document.createElement("span");
  note.className   = "dash-dl-note";
  note.textContent = trackType === "video"
    ? "⚠ 映像のみ（無音）— FFmpeg ステップで統合予定"
    : "⚠ 音声のみ — FFmpeg ステップで統合予定";
  btn.insertAdjacentElement("afterend", note);
}

/** 帯域幅を人間が読みやすい単位に変換（Kbps / Mbps）*/
function formatBandwidth(bps) {
  if (!bps) return "";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1_000)} Kbps`;
}

/**
 * m3u8 アイテムのアコーディオン展開・折りたたみをトグルする。
 * 展開済みなら折りたたむ、未展開なら FETCH_HLS_VARIANTS を送信して展開する。
 */
