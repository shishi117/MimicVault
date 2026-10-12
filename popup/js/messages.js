// popup/js/messages.js — MimicVault
// background からの進捗/状態メッセージ受信（downloads.onChanged / runtime.onMessage）

"use strict";

// content script が注入するこのパネル（popup.html を読み込む iframe）では
// browser.downloads が未定義になる（Firefox の制約。ページに重ねた iframe には
// 一部の特権APIが渡らない）。ガード無しで呼ぶと例外で以降の行（下の
// runtime.onMessage.addListener も含む）が一切実行されず、HLS/DASH/収集
// ストリーム/ライブ録画/分割DL の進捗通知が軒並み届かなくなる。
if (browser.downloads?.onChanged) {
  browser.downloads.onChanged.addListener((delta) => {
    const url = downloadIdToUrl.get(delta.id);
    if (!url) return;

    const ds = downloadStates.get(url);
    if (!ds) return;

    // 進捗更新
    if (delta.bytesReceived && delta.totalBytes) {
      const received = delta.bytesReceived.current ?? 0;
      const total    = delta.totalBytes.current ?? 0;
      if (total > 0) ds.progress = Math.round((received / total) * 100);
    }

    // 状態遷移
    if (delta.state) {
      const next = delta.state.current;
      if (next === "complete")     ds.state = "complete";
      if (next === "interrupted")  ds.state = "interrupted";
    }
    if (delta.error) {
      ds.state = "error";
    }

    // ボタン UI を更新する
    updateDownloadButton(url);
  });
}

/**
 * background から届く HLS セグメント取得の進捗を受け取り、
 * バリアント DL ボタンの表示を更新する。
 */
browser.runtime.onMessage.addListener((message) => {
  // ── ステップ12: DASH セグメント取得の進捗 ────────────────────────────────
  if (message.type === "DASH_DOWNLOAD_PROGRESS") {
    const { mpdUrl, repId, current, total } = message;
    const key = `${mpdUrl}::${repId}`;
    const dds = dashDownloadStates.get(key);
    if (dds) {
      dds.current = current;
      dds.total   = total;
      updateDashDownloadButton(key);
    }
    return;
  }

  if (message.type === "HLS_DOWNLOAD_PROGRESS") {
    const { url, current, total, converting } = message;
    const hds = hlsDownloadStates.get(url);
    if (!hds) return;
    hds.current    = current;
    hds.total      = total;
    hds.converting = converting ?? false; // true = FFmpeg 変換フェーズ（ステップ16）
    updateHlsDownloadButton(url);
    return;
  }

  // ── v0.18.0: DASH mux 進捗 ────────────────────────────────────────────────
  if (message.type === "DASH_MUX_PROGRESS") {
    const { mpdUrl, phase, current, total } = message;
    const muxKey = `${mpdUrl}::mux`;
    let mds = dashMuxStates.get(mpdUrl);
    if (mds) {
      mds.phase   = phase;
      mds.current = current;
      mds.total   = total;
      updateDashMuxButton(mpdUrl);
    }
    return;
  }

  // ── v0.19.0: 収集ストリーム（孤立セグメント）取得の進捗 ───────────────────
  if (message.type === "SEGMENT_GROUP_PROGRESS") {
    const ds = downloadStates.get(message.url);
    if (ds && message.total > 0) {
      ds.progress = Math.round((message.current / message.total) * 100);
      updateDownloadButton(message.url);
    }
    return;
  }

  // 直接ファイル（mp4等）の Range 分割DL取得の進捗（downloadDirectRanged.js）
  if (message.type === "DIRECT_DOWNLOAD_PROGRESS") {
    const ds = downloadStates.get(message.url);
    if (ds && message.total > 0) {
      ds.progress = Math.round((message.current / message.total) * 100);
      updateDownloadButton(message.url);
    }
    return;
  }

  // ── v0.18.0: DASH mux フォールバック通知 ─────────────────────────────────
  if (message.type === "DASH_MUX_FALLBACK") {
    showToast("companion 未接続のため映像・音声を別ファイルで保存します");
    return;
  }

  // ── ステップ15: companion 接続状態変化の通知 ───────────────────────────────
  if (message.type === "COMPANION_STATUS") {
    updateCompanionIndicator(message.status ?? "disconnected");
    return;
  }

  // ── ステップ10: ライブ録画進捗 ────────────────────────────────────────────
  if (message.type === "LIVE_RECORDING_PROGRESS") {
    const { url, state, totalSegments, chunkIndex, stem } = message;

    let lrs = liveRecordingStates.get(url);
    if (!lrs) {
      lrs = { state: "recording", totalSegments: 0, chunkIndex: 0, stem: stem ?? "" };
      liveRecordingStates.set(url, lrs);
    }
    lrs.state         = state;
    lrs.totalSegments = totalSegments;
    lrs.chunkIndex    = chunkIndex;
    if (stem) lrs.stem = stem;

    // バナーを更新（状態変化時は全体再構築、統計更新のみなら軽量パス）
    if (state === "recording" && liveRecordingStates.has(url)) {
      updateLiveBannerStats(url);  // 数値だけ書き換え（軽量）
    } else {
      buildLiveRecordingBanner();  // 開始・終了・停止時は再構築
    }

    // バリアントボタンがあれば更新
    updateLiveRecordingButton(url);
  }
});

