// popup/js/dlEntryStatus.js — MimicVault
// DL エントリの状態・再試行・完了クリア getDlEntryStatusText ほか

"use strict";

function getDlEntryStatusText(entry) {
  switch (entry.kind) {
    case "direct":
      switch (entry.state) {
        case "downloading": return entry.progress > 0 ? `${entry.progress}%` : "ダウンロード中…";
        case "complete":    return "✓ 完了";
        case "error":       return "✗ エラー（再試行可）";
        case "interrupted": return "✗ 中断（再試行可）";
        default:            return "待機中";
      }
    case "hls":
      switch (entry.state) {
        case "fetching":
          // ステップ16: FFmpeg 変換フェーズか通常セグメント取得かで表示を切り替え
          if (entry.converting) {
            return entry.current < 100
              ? `⚡ FFmpeg 変換中… ${entry.current}%`
              : "⚡ FFmpeg 変換中…";
          }
          return entry.total > 0
            ? `取得中… ${entry.current} / ${entry.total} セグメント`
            : "セグメント取得中…";
        case "complete":  return entry.converting ? "✓ 完了 (.mp4)" : "✓ 完了 (.ts)";
        case "error":     return `✗ ${hlsErrorMessage(entry.error)}`;
        default:          return "待機中";
      }
    case "dash":
      switch (entry.state) {
        case "fetching":  return entry.total > 0
          ? `取得中… ${entry.current} / ${entry.total} セグメント`
          : "セグメント取得中…";
        case "complete":  return "✓ 完了（映像/音声別）";
        case "error":     return `✗ ${dashDownloadErrorMessage(entry.error)}`;
        default:          return "待機中";
      }
    case "live":
      switch (entry.state) {
        case "recording": return `● 録画中 — ${entry.totalSegments} セグメント`;
        case "stopped":   return `✓ 録画停止 — ${entry.totalSegments} セグメント`;
        case "ended":     return `✓ 録画完了 — ${entry.chunkIndex} ファイル`;
        default:          return "不明";
      }
    default:
      return "";
  }
}

/** プログレスバーが必要かどうか */
function dlEntryNeedsBar(entry) {
  if (entry.kind === "direct" && entry.state === "downloading" && entry.progress > 0) return true;
  if ((entry.kind === "hls" || entry.kind === "dash") &&
      entry.state === "fetching" && entry.total > 0) return true;
  return false;
}

/** プログレスバーのパーセント（0〜100）を返す */
function getDlEntryPercent(entry) {
  if (entry.kind === "direct") return entry.progress;
  if (entry.total > 0) return Math.round((entry.current / entry.total) * 100);
  return 0;
}

/**
 * ダウンロードをリトライする。
 * 状態をリセットして元のダウンロード関数を再呼び出しする。
 * ボタンは DL パネル内に存在しないため、ダミー要素を使う。
 */
function retryDownload(entry) {
  const fakeBtn = document.createElement("button");

  if (entry.kind === "direct" && entry.item) {
    downloadStates.delete(entry.key);
    startDownload(entry.item, fakeBtn);
  } else if (entry.kind === "hls" && entry.item) {
    hlsDownloadStates.delete(entry.key);
    startHlsSegmentDownload(entry.item, entry.key, fakeBtn);
  } else if (entry.kind === "dash" && entry.item && entry.rep) {
    dashDownloadStates.delete(entry.key);
    startDashTrackDownload(entry.item, entry.rep, entry.trackType, fakeBtn);
  }

  // 即時 UI 反映
  renderDlPanel();
}

/**
 * 完了・失敗・停止状態のエントリを全マップから除去する。
 * 「完了をクリア」ボタンから呼ばれる。
 */
function clearCompletedDownloads() {
  for (const [url, ds] of [...downloadStates]) {
    if (ds.state !== "downloading") {
      downloadStates.delete(url);
      downloadMeta.delete(url);
      if (ds.downloadId != null) downloadIdToUrl.delete(ds.downloadId);
    }
  }
  for (const [url, hds] of [...hlsDownloadStates]) {
    if (hds.state !== "fetching") {
      hlsDownloadStates.delete(url);
      hlsDownloadMeta.delete(url);
    }
  }
  for (const [key, dds] of [...dashDownloadStates]) {
    if (dds.state !== "fetching") {
      dashDownloadStates.delete(key);
      dashDownloadMeta.delete(key);
    }
  }
  for (const [url, lrs] of [...liveRecordingStates]) {
    if (lrs.state !== "recording") {
      liveRecordingStates.delete(url);
    }
  }
}

