// background/companionHls.js — MimicVault
// HLS→MP4 companion 変換パス downloadHlsViaCompanion

"use strict";

// ─── HLS → MP4 companion 変換パス（ステップ16） ──────────────────────────────

/**
 * companion app 経由で HLS を FFmpeg によって MP4 に変換してダウンロードする。
 * companion が失敗した場合は例外を投げる（呼び出し元でフォールバックを処理する）。
 *
 * フロー:
 *   1. companion に { type: "convert", playlistUrl, referer, outputName } を送信
 *   2. companion が FFmpeg を実行し、進捗を { type: "progress", percent } で通知
 *   3. companion が変換完了後に { ok: true, filePath } を返す
 *   4. 返された filePath をブラウザのダウンロードシステムに渡す
 *      → ダウンロードフォルダへの保存は companion が直接行うため
 *        downloadId は null になる場合がある（ポップアップでは "保存済み" 表示）
 *
 * @param {string} mediaPlaylistUrl - HLS Media Playlist URL
 * @param {string} pageURL          - Referer 用の元ページ URL
 * @param {number} [tabId]          - ファイル名にタブタイトルを使うための元タブ ID
 * @returns {Promise<{ ok: true, downloadId: null, filePath: string } | { ok: false, error: string }>}
 */
async function downloadHlsViaCompanion(mediaPlaylistUrl, pageURL, tabId) {
  // ファイル名（.mp4 拡張子）を決める。URL は多くの配信元で "video.m3u8" 等の
  // 定型名なので、タブの表示タイトルが取れればそちらを優先する。
  const stem = await inferTitleStem(mediaPlaylistUrl, tabId);
  const outputName = applyFilenameTemplate(stem, "mp4");

  // companion に変換を依頼し、進捗を popup に中継する
  // navigator.userAgent も渡す: ffmpeg はデフォルトで "Lavf/x.y.z" という
  // 非ブラウザ UA を送るため、Referer しかないと CDN の anti-leech に
  // ブロックされ m3u8 の代わりにエラーページを返されることがある。
  const result = await sendToCompanion(
    {
      type:        "convert",
      playlistUrl: mediaPlaylistUrl,
      referer:     pageURL || "",
      userAgent:   navigator.userAgent,
      outputName,
    },
    (progressMsg) => {
      // companion からの進捗通知を popup に転送。
      // ブロードキャスト（sendMessage）に加えて hlsProgressState にも書いておく
      // （content script 注入のパネル iframe にはブロードキャストが届かない
      // ことがあるため、GET_HLS_PROGRESS での問い合わせでも拾えるようにする）。
      hlsProgressState.set(mediaPlaylistUrl, { current: progressMsg.percent ?? 0, total: 100, converting: true });
      browser.runtime.sendMessage({
        type:       "HLS_DOWNLOAD_PROGRESS",
        url:        mediaPlaylistUrl,
        current:    progressMsg.percent ?? 0,
        total:      100,
        converting: true,  // FFmpeg 変換フェーズのフラグ
      }).catch(() => {});
    }
  );

  if (!result.ok) {
    throw new Error(result.error ?? "companion conversion failed");
  }

  // 変換完了 — filePath はユーザーの Downloads フォルダ内のパス
  // popup に 100% 完了を通知
  hlsProgressState.set(mediaPlaylistUrl, { current: 100, total: 100, converting: true });
  browser.runtime.sendMessage({
    type:       "HLS_DOWNLOAD_PROGRESS",
    url:        mediaPlaylistUrl,
    current:    100,
    total:      100,
    converting: true,
  }).catch(() => {});

  return { ok: true, downloadId: null, filePath: result.filePath };
}

