// popup/js/downloadButton.js — MimicVault
// 直接ダウンロードボタン buildDownloadButton/startDownload

"use strict";

function buildDownloadButton(item) {
  const btn = document.createElement("button");
  btn.className = "dl-btn";
  btn.dataset.url = item.url;
  btn.title = "ダウンロード";

  // m3u8 は既定DLでも変換経路に回す（companion 接続時は1本のMP4、未接続時は
  // 結合した .ts）。生の .m3u8 テキストを保存しても使えないため。
  const isHls = isHlsUrl(item.url) || (item.mimeHint || "").includes("mpegurl");

  if (isHls) {
    applyHlsDownloadButtonState(btn, hlsDownloadStates.get(item.url));
    btn.addEventListener("click", () => startHlsSegmentDownload(item, item.url, btn));
  } else {
    applyDownloadButtonState(btn, downloadStates.get(item.url));
    // 直接DL（HLS/DASH でない生ファイル）はブラウザのDL機能を使うため履歴に残り
    // “見せかけ”できない。誤操作で痕跡を残さないよう2段階クリックで確認させる。
    const isDirect = mediaMethodLabel(item) === "直接";
    btn.addEventListener("click", () => {
      if (isDirect && !btn.dataset.confirm) {
        // 1回目: 警告して確認待ちにする
        btn.dataset.confirm = "1";
        btn.textContent = "⚠ 直接DL?";
        showToast("直接DLはブラウザのDL機能を使用し履歴に残ります。通常アクセスに見せかけできません。もう一度押すと実行します");
        clearTimeout(btn._confirmTimer);
        btn._confirmTimer = setTimeout(() => {
          delete btn.dataset.confirm;
          applyDownloadButtonState(btn, downloadStates.get(item.url));
        }, 4000);
        return;
      }
      clearTimeout(btn._confirmTimer);
      delete btn.dataset.confirm;
      startDownload(item, btn);
    });
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

  try {
    const res = await browser.runtime.sendMessage({
      type:     "DOWNLOAD_MEDIA",
      url:      item.url,
      mimeHint: item.mimeHint ?? "",
      pageURL:  item.pageURL  ?? "",  // Referer として使う元ページ URL
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

