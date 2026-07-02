// popup/js/dlPanel.js — MimicVault
// DL パネル収集と描画 gatherDlEntries/renderDlPanel

"use strict";

// ─── DL パネル（ステップ14） ──────────────────────────────────────────────────

/**
 * 全ダウンロード状態マップを統合してエントリ配列を生成する。
 * 新しい開始順に並ぶ（detectedAt 降順）。
 */
function gatherDlEntries() {
  const entries = [];

  // 直接ダウンロード
  for (const [url, ds] of downloadStates) {
    const meta = downloadMeta.get(url);
    entries.push({
      key:        url,
      kind:       "direct",
      filename:   extractFilename(url),
      state:      ds.state,
      progress:   ds.progress ?? 0,
      downloadId: ds.downloadId,
      item:       meta?.item,
      detectedAt: meta?.detectedAt ?? 0,
    });
  }

  // HLS VOD セグメントダウンロード
  for (const [url, hds] of hlsDownloadStates) {
    const meta = hlsDownloadMeta.get(url);
    entries.push({
      key:        url,
      kind:       "hls",
      filename:   extractFilename(url),
      state:      hds.state,
      current:    hds.current,
      total:      hds.total,
      error:      hds.error,
      item:       meta?.item,
      detectedAt: meta?.detectedAt ?? 0,
    });
  }

  // DASH トラックダウンロード
  for (const [key, dds] of dashDownloadStates) {
    const meta = dashDownloadMeta.get(key);
    const suffix = meta?.trackType === "video" ? " [映像]"
                 : meta?.trackType === "audio" ? " [音声]"
                 : "";
    entries.push({
      key,
      kind:       "dash",
      filename:   (meta ? extractFilename(meta.item?.url ?? "") : key) + suffix,
      state:      dds.state,
      current:    dds.current,
      total:      dds.total,
      error:      dds.error,
      item:       meta?.item,
      rep:        meta?.rep,
      trackType:  meta?.trackType,
      detectedAt: meta?.detectedAt ?? 0,
    });
  }

  // ライブ録画セッション
  for (const [url, lrs] of liveRecordingStates) {
    entries.push({
      key:           url,
      kind:          "live",
      filename:      lrs.stem || extractFilename(url),
      state:         lrs.state,
      totalSegments: lrs.totalSegments,
      chunkIndex:    lrs.chunkIndex,
      detectedAt:    0,
    });
  }

  // 新しい順（detectedAt 降順）
  entries.sort((a, b) => (b.detectedAt - a.detectedAt));
  return entries;
}

/** DL エントリの総件数を返す（タブバッジのカウント用）*/
function countDlEntries() {
  return downloadStates.size + hlsDownloadStates.size +
         dashDownloadStates.size + liveRecordingStates.size;
}

/** DL パネルを全面再描画する */
function renderDlPanel() {
  elDlPanel.innerHTML = "";

  const entries = gatherDlEntries();

  // ── ツールバー（件数 + 完了をクリアボタン） ──────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "dl-panel-toolbar";

  const countEl = document.createElement("span");
  countEl.className = "dl-panel-count";
  countEl.textContent = `${entries.length} 件`;

  const clearBtn = document.createElement("button");
  clearBtn.className = "dl-clear-btn";
  clearBtn.textContent = "完了をクリア";
  const hasCompleted = entries.some(e =>
    e.state === "complete" || e.state === "interrupted" ||
    e.state === "stopped"  || e.state === "ended"
  );
  clearBtn.disabled = !hasCompleted;
  clearBtn.addEventListener("click", () => {
    clearCompletedDownloads();
    renderDlPanel();
    // フッター件数も更新
    elCount.textContent = `${countDlEntries()} 件のDL`;
  });

  toolbar.appendChild(countEl);
  toolbar.appendChild(clearBtn);
  elDlPanel.appendChild(toolbar);

  // ── エントリが0件のとき ────────────────────────────────────────────────
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dl-empty";
    empty.textContent = "ダウンロード履歴がありません";
    elDlPanel.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    elDlPanel.appendChild(buildDlEntry(entry));
  }
}

/**
 * DL エントリ1件分の DOM を構築して返す。
 * @param {object} entry - gatherDlEntries() が返すエントリオブジェクト
 */
