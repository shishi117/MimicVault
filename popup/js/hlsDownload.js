// popup/js/hlsDownload.js — MimicVault
// HLS セグメントダウンロードボタン buildHlsVariantDownloadButton/startHlsSegmentDownload

"use strict";

// ─── HLS バリアント専用ダウンロードボタン ─────────────────────────────────────

/**
 * HLS バリアント（Media Playlist URL）用の DL ボタンを生成する。
 * 通常の browser.downloads とは別フロー（DOWNLOAD_HLS_SEGMENTS）を使うため、
 * buildDownloadButton とは独立した実装にする。
 *
 * @param {object} item         - 元アイテム（pageURL など引き継ぐ）
 * @param {string} variantUrl   - バリアントの Media Playlist URL
 */
function buildHlsVariantDownloadButton(item, variantUrl) {
  const btn = document.createElement("button");
  btn.className = "dl-btn";
  btn.dataset.url = variantUrl;
  btn.title = "HLS セグメントをダウンロード";

  const hds = hlsDownloadStates.get(variantUrl);
  applyHlsDownloadButtonState(btn, hds);

  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // アコーディオンのトグルを防ぐ
    startHlsSegmentDownload(item, variantUrl, btn);
  });

  return btn;
}

/**
 * DOWNLOAD_HLS_SEGMENTS を background に送り、セグメントダウンロードを開始する。
 */
async function startHlsSegmentDownload(item, variantUrl, btn) {
  const existing = hlsDownloadStates.get(variantUrl);
  if (existing && existing.state === "fetching") return; // 二重起動防止

  // 状態を初期化してすぐ UI を更新
  const hds = { state: "fetching", current: 0, total: 0 };
  hlsDownloadStates.set(variantUrl, hds);
  applyHlsDownloadButtonState(btn, hds);

  // HLS_DOWNLOAD_PROGRESS のブロードキャストは、ページに重ねるパネル
  // （content script 注入の iframe）には届かないことがある。そのため
  // background の hlsProgressState を直接ポーリングして補う
  // （background/constants.js の hlsProgressState 参照）。
  const pollTimer = setInterval(async () => {
    if (hds.state !== "fetching") return;
    let progress;
    try {
      progress = await browser.runtime.sendMessage({ type: "GET_HLS_PROGRESS", url: variantUrl });
    } catch (_) { return; }
    if (!progress || hds.state !== "fetching") return;
    hds.current    = progress.current;
    hds.total      = progress.total;
    hds.converting = progress.converting ?? false;
    applyHlsDownloadButtonState(btn, hds);
  }, 700);

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:    "DOWNLOAD_HLS_SEGMENTS",
      url:     variantUrl,
      pageURL: item.pageURL ?? "",
      tabId:   currentTabId,
    });
  } catch (err) {
    result = { ok: false, error: err.message };
  } finally {
    clearInterval(pollTimer);
  }

  if (result?.ok) {
    // ── ステップ10: ライブストリーム ─────────────────────────────────────────
    if (result.live) {
      // hlsDownloadStates からは外してライブ状態管理に移行
      hlsDownloadStates.delete(variantUrl);
      const lrs = {
        state:         "recording",
        totalSegments: 0,
        chunkIndex:    0,
        stem:          "",
      };
      liveRecordingStates.set(variantUrl, lrs);
      buildLiveRecordingBanner();
      applyLiveRecordingButtonState(btn, lrs, variantUrl);
      return;
    }
    // ── VOD 完了 ─────────────────────────────────────────────────────────────
    hds.state = "complete";
    // companion（FFmpeg）経由の変換が成功した場合のみ .mp4 になるので注記不要。
    // fallbackExt が ts の場合のみ「VLC等が必要」の注記を出す（mp4 で保存された
    // 場合は fMP4 のまま既に再生可能なので、変換失敗していても注記は不要）。
    if (!result.filePath && result.fallbackExt === "ts") {
      showHlsTsNote(btn, result.remuxError);
    }
  } else {
    hds.state = "error";
    hds.error = result?.error ?? "unknown";
  }

  applyHlsDownloadButtonState(btn, hds);
}

/**
 * URL をキーにして HLS DL ボタン DOM を探し、最新状態を反映する。
 * HLS_DOWNLOAD_PROGRESS コールバックから呼ばれる。
 */
function updateHlsDownloadButton(url) {
  // バリアントボタンは hls-variants リスト内にある
  const btn = document.querySelector(`.hls-variants .dl-btn[data-url="${CSS.escape(url)}"]`);
  if (!btn) return;
  applyHlsDownloadButtonState(btn, hlsDownloadStates.get(url));
}

/**
 * HLS ダウンロード状態に応じてボタンのテキスト・クラスを更新する。
 *
 * state === "fetching":
 *   total が不明（0）なら「…」、判明後は「x / y」セグメント表示
 * state === "complete":
 *   「✓ 完了」
 * state === "error":
 *   エラー種別に応じた日本語メッセージ
 */
function applyHlsDownloadButtonState(btn, hds) {
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");
  btn.disabled = false;

  if (!hds) {
    btn.textContent = "↓ DL";
    return;
  }

  switch (hds.state) {
    case "fetching": {
      btn.classList.add("dl-btn--downloading");
      btn.disabled = true;
      // ステップ16: FFmpeg 変換フェーズか、セグメント取得フェーズかで表示を切り替え
      if (hds.converting) {
        // companion による FFmpeg 変換中（current = 進捗 %, total = 100）
        btn.textContent = hds.current < 100
          ? `⚡ ${hds.current}%`
          : "⚡ 変換中…";
      } else if (hds.total > 0) {
        btn.textContent = `${hds.current} / ${hds.total}`;
      } else {
        btn.textContent = "…";
      }
      break;
    }
    case "complete":
      btn.textContent = "✓ 完了";
      btn.classList.add("dl-btn--complete");
      btn.disabled = true;
      break;
    case "error": {
      const msg = hlsErrorMessage(hds.error);
      btn.textContent = `✗ ${msg}`;
      btn.classList.add("dl-btn--error");
      btn.title = msg;
      break;
    }
    default:
      btn.textContent = "↓ DL";
  }
}

/**
 * HLS ダウンロード完了後にボタン下へ注記を表示する。
 * .ts ファイルは QuickTime・ブラウザでは再生できず、VLC 等が必要なため。
 * remuxError があれば、MP4 変換を試みて失敗した理由として併記する。
 */
function showHlsTsNote(btn, remuxError) {
  // すでに注記があればスキップ
  if (btn.parentElement?.querySelector(".hls-ts-note")) return;

  const note = document.createElement("span");
  note.className = "hls-ts-note";
  note.textContent = remuxError
    ? `⚠ .ts形式(MP4変換失敗: ${remuxError}) — VLC / mpv で再生可`
    : "⚠ .ts 形式 — VLC / mpv で再生可";
  btn.insertAdjacentElement("afterend", note);
}

/** エラーコードを日本語メッセージに変換 */
function hlsErrorMessage(error) {
  switch (error) {
    case "encrypted":       return "暗号化ストリームは未対応";   // 旧コード（念のため残す）
    case "sample_aes":      return "DRM 保護コンテンツは未対応";
    case "no_segments":     return "セグメントなし";
    case "master_playlist": return "画質を選択してください";
    default:                return `エラー: ${error ?? "不明"}`;
  }
}

