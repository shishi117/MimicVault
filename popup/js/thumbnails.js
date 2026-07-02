// popup/js/thumbnails.js — MimicVault
// サムネイル取得キュー requestThumbnails/enqueueThumb/fetchThumb

"use strict";

// ─── サムネイルリクエスト ─────────────────────────────────────────────────────

/**
 * リスト内の未取得アイテムを順番にキューへ積む。
 * background キャッシュ済み（img--loaded クラス付き）はスキップ。
 */
function requestThumbnails(tabId) {
  const imgs = elList.querySelectorAll(".thumb-img:not(.thumb-img--loaded):not(.thumb-img--failed)");
  for (const img of imgs) {
    enqueueThumb(img.dataset.url, tabId, img);
  }
}

// ─── サムネイルキュー ─────────────────────────────────────────────────────────
/**
 * サムネイル取得は content.js の隠れ <video> を使うため、同時に複数走ると
 * ページの帯域・CPU を圧迫する。ここでは最大 2 並列に制限するキューを使う。
 */
const THUMB_CONCURRENCY = 2;
let thumbRunning = 0;
const thumbQueue = []; // { url, tabId, imgEl } の配列

function enqueueThumb(url, tabId, imgEl) {
  thumbQueue.push({ url, tabId, imgEl });
  drainThumbQueue();
}

function drainThumbQueue() {
  while (thumbRunning < THUMB_CONCURRENCY && thumbQueue.length > 0) {
    const task = thumbQueue.shift();
    thumbRunning++;
    fetchThumb(task).finally(() => {
      thumbRunning--;
      drainThumbQueue();
    });
  }
}

/**
 * content.js に CAPTURE_THUMBNAIL を送信し、返ってきた dataURL を
 * img 要素に反映する。成功したら background にもキャッシュ保存する。
 */
async function fetchThumb({ url, tabId, imgEl }) {
  try {
    const res = await browser.tabs.sendMessage(tabId, {
      type: "CAPTURE_THUMBNAIL",
      url,
    });
    if (res?.ok && res.dataURL) {
      imgEl.src = res.dataURL;
      imgEl.classList.add("thumb-img--loaded");
      // background にキャッシュ（ポップアップを閉じても保持）
      browser.runtime.sendMessage({
        type:   "SET_THUMBNAIL",
        tabId,
        url,
        dataURL: res.dataURL,
      }).catch(() => {});
    } else {
      // CORS / タイムアウト → プレースホルダーのまま（エラー表示は不要）
      imgEl.classList.add("thumb-img--failed");
    }
  } catch (_) {
    imgEl.classList.add("thumb-img--failed");
  }
}



