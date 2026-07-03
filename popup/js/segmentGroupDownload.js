// popup/js/segmentGroupDownload.js — MimicVault
// 収集ストリーム（孤立セグメントグループ）のダウンロード startSegmentGroupDownload

"use strict";

/**
 * DOWNLOAD_SEGMENT_GROUP を background に送り、断片の再取得・結合を開始する。
 * 進捗は SEGMENT_GROUP_PROGRESS（messages.js）で downloadStates に反映される。
 */
async function startSegmentGroupDownload(item, btn) {
  const existing = downloadStates.get(item.url);
  if (existing && existing.state === "downloading") return;

  const ds = { downloadId: null, state: "downloading", progress: 0 };
  downloadStates.set(item.url, ds);
  applyDownloadButtonState(btn, ds);

  let res;
  try {
    res = await browser.runtime.sendMessage({
      type:     "DOWNLOAD_SEGMENT_GROUP",
      groupKey: item.groupKey,
      tabId:    currentTabId,
    });
  } catch (err) {
    res = { ok: false, error: err.message };
  }

  if (res?.ok) {
    ds.state = "complete";
    // companion 未接続時は blob DL なので downloadId が付く（onChanged で完了検知）
    if (res.downloadId != null) {
      ds.downloadId = res.downloadId;
      downloadIdToUrl.set(res.downloadId, item.url);
    }
  } else {
    ds.state = "error";
  }
  applyDownloadButtonState(btn, ds);
}
