// popup/js/downloadButton.js — MimicVault
// ダウンロードボタン buildDownloadButton/startDownload

"use strict";

function buildDownloadButton(item) {
  const btn = document.createElement("button");
  btn.className = "dl-btn";
  btn.dataset.url = item.url;
  btn.title = "ダウンロード";

  // 収集ストリーム（孤立セグメントグループ）は専用の結合DLに回す
  if (item.isSegmentGroup) {
    applyDownloadButtonState(btn, downloadStates.get(item.url));
    btn.addEventListener("click", () => startSegmentGroupDownload(item, btn));
    return btn;
  }

  // m3u8 は既定DLでも変換経路に回す（companion 接続時は1本のMP4、未接続時は
  // 結合した .ts）。生の .m3u8 テキストを保存しても使えないため。
  const isHls = isHlsUrl(item.url) || (item.mimeHint || "").includes("mpegurl");

  if (isHls) {
    applyHlsDownloadButtonState(btn, hlsDownloadStates.get(item.url));
    btn.addEventListener("click", () => startHlsSegmentDownload(item, item.url, btn));
  } else {
    // DASH、または通常の progressive 直リンク（mp4等）。
    // 直リンクは background 側で再生時のような Range 分割DLに回される
    // （downloadDirectRanged.js）。
    applyDownloadButtonState(btn, downloadStates.get(item.url));
    btn.addEventListener("click", () => startDownload(item, btn));
  }

  return btn;
}

/**
 * ダウンロードを開始する。
 * background に DOWNLOAD_MEDIA メッセージを送り、返ってきた downloadId を保存する。
 */
async function startDownload(item, btn) {
  // すでにダウンロード中・完了済みの場合は再ダウンロードしない
  const existing = downloadStates.get(item.url);
  if (existing && existing.state === "downloading") return;

  // 状態を初期化してすぐ UI を更新
  const ds = { downloadId: null, state: "downloading", progress: 0 };
  downloadStates.set(item.url, ds);
  applyDownloadButtonState(btn, ds);

  // DIRECT_DOWNLOAD_PROGRESS のブロードキャストは、ページに重ねるパネル
  // （content script 注入の iframe）には届かないことがある。そのため
  // background の directDownloadProgressState を直接ポーリングして補う
  // （popup/js/hlsDownload.js の GET_HLS_PROGRESS ポーリングと同じ理由）。
  const pollTimer = setInterval(async () => {
    if (ds.state !== "downloading") return;
    let progress;
    try {
      progress = await browser.runtime.sendMessage({ type: "GET_DIRECT_DOWNLOAD_PROGRESS", url: item.url });
    } catch (_) { return; }
    if (!progress || ds.state !== "downloading" || !(progress.total > 0)) return;
    ds.progress = Math.round((progress.current / progress.total) * 100);
    applyDownloadButtonState(btn, ds);
  }, 700);

  try {
    const res = await browser.runtime.sendMessage({
      type:          "DOWNLOAD_MEDIA",
      url:           item.url,
      mimeHint:      item.mimeHint ?? "",
      pageURL:       item.pageURL  ?? "",  // Referer として使う元ページ URL
      contentLength: item.contentLength ?? null, // 検出時に分かっていればRange分割に使う
    });

    if (res?.ok) {
      ds.downloadId = res.downloadId;
      downloadIdToUrl.set(res.downloadId, item.url);
    } else {
      ds.state = "error";
      applyDownloadButtonState(btn, ds);
    }
  } catch (_) {
    ds.state = "error";
    applyDownloadButtonState(btn, ds);
  } finally {
    clearInterval(pollTimer);
  }
}

/**
 * URL をキーにしてボタン DOM を探し、最新の downloadStates を反映する。
 * （onChanged コールバックから呼ばれる）
 */
function updateDownloadButton(url) {
  const btn = elList.querySelector(`.dl-btn[data-url="${CSS.escape(url)}"]`);
  if (!btn) return;
  applyDownloadButtonState(btn, downloadStates.get(url));
}

/**
 * ダウンロード状態に応じてボタンのテキスト・クラスを設定する。
 */
function applyDownloadButtonState(btn, ds) {
  // リセット
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");
  btn.disabled = false;

  if (!ds) {
    // 未着手
    btn.textContent = "↓ DL";
    return;
  }

  switch (ds.state) {
    case "downloading":
      btn.textContent = ds.progress > 0 ? `${ds.progress}%` : "…";
      btn.classList.add("dl-btn--downloading");
      btn.disabled = true;
      break;
    case "complete":
      btn.textContent = "✓ 完了";
      btn.classList.add("dl-btn--complete");
      btn.disabled = true;
      break;
    case "error":
    case "interrupted":
      btn.textContent = "✗ 再試行";
      btn.classList.add("dl-btn--error");
      break;
    default:
      btn.textContent = "↓ DL";
  }
}

