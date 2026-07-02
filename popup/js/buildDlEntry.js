// popup/js/buildDlEntry.js — MimicVault
// DL パネルの各エントリ生成 buildDlEntry

"use strict";

function buildDlEntry(entry) {
  const div = document.createElement("div");
  div.className = "dl-entry";

  // ── ヘッダー行: タイプバッジ + ファイル名 + アクションボタン ──────────────
  const header = document.createElement("div");
  header.className = "dl-entry-header";

  // タイプバッジ
  const badge = document.createElement("span");
  badge.className = `dl-type-badge dl-type-badge--${entry.kind}`;
  badge.textContent = { direct: "直接", hls: "HLS", dash: "DASH", live: "LIVE" }[entry.kind] ?? entry.kind;

  // ファイル名
  const filenameEl = document.createElement("span");
  filenameEl.className = "dl-entry-filename";
  filenameEl.textContent = entry.filename;
  filenameEl.title = entry.key;

  // アクションボタン群
  const actionArea = document.createElement("div");
  actionArea.className = "dl-entry-actions";

  // キャンセルボタン（直接DLのみ、ダウンロード中）
  if (entry.kind === "direct" && entry.state === "downloading" && entry.downloadId != null) {
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "dl-action-btn dl-action-btn--cancel";
    cancelBtn.textContent = "✕";
    cancelBtn.title = "キャンセル";
    cancelBtn.addEventListener("click", () => {
      browser.downloads.cancel(entry.downloadId).catch(() => {});
      const ds = downloadStates.get(entry.key);
      if (ds) ds.state = "interrupted";
      renderDlPanel();
    });
    actionArea.appendChild(cancelBtn);
  }

  // リトライボタン（エラー / 中断時）
  if (entry.state === "error" || entry.state === "interrupted") {
    const retryBtn = document.createElement("button");
    retryBtn.className = "dl-action-btn dl-action-btn--retry";
    retryBtn.textContent = "↺ 再試行";
    retryBtn.addEventListener("click", () => retryDownload(entry));
    actionArea.appendChild(retryBtn);
  }

  header.appendChild(badge);
  header.appendChild(filenameEl);
  header.appendChild(actionArea);
  div.appendChild(header);

  // ── ステータス行 + プログレスバー ─────────────────────────────────────────
  const statusRow = document.createElement("div");
  statusRow.className = "dl-entry-status-row";

  const statusEl = document.createElement("span");
  statusEl.className = "dl-entry-status";
  statusEl.textContent = getDlEntryStatusText(entry);
  statusRow.appendChild(statusEl);

  // プログレスバー（進捗が判明している場合のみ）
  if (dlEntryNeedsBar(entry)) {
    const bar = document.createElement("div");
    bar.className = "dl-progress-bar";
    const fill = document.createElement("div");
    fill.className = "dl-progress-fill";
    fill.style.width = `${getDlEntryPercent(entry)}%`;
    bar.appendChild(fill);
    statusRow.appendChild(bar);
  }

  div.appendChild(statusRow);
  return div;
}

/** エントリのステータス文字列を返す */
