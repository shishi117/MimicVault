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
 * @returns {Promise<{ ok: true, downloadId: null, filePath: string } | { ok: false, error: string }>}
 */
async function downloadHlsViaCompanion(mediaPlaylistUrl, pageURL) {
  // ファイル名（.mp4 拡張子）を決める
  const outputName = applyFilenameTemplate(inferStem(mediaPlaylistUrl), "mp4");

  // companion に変換を依頼し、進捗を popup に中継する
  const result = await sendToCompanion(
    {
      type:        "convert",
      playlistUrl: mediaPlaylistUrl,
      referer:     pageURL || "",
      outputName,
    },
    (progressMsg) => {
      // companion からの進捗通知を popup に転送
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
  browser.runtime.sendMessage({
    type:       "HLS_DOWNLOAD_PROGRESS",
    url:        mediaPlaylistUrl,
    current:    100,
    total:      100,
    converting: true,
  }).catch(() => {});

  return { ok: true, downloadId: null, filePath: result.filePath };
}

