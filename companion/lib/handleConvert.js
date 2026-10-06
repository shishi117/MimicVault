// companion/lib/handleConvert.js — MimicVault
// HLS → MP4 変換 handleConvert
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { sendMessage } = require("./io");
const { FFMPEG, getDownloadsDir } = require("./ffmpeg");

// ─── HLS → MP4 変換（ステップ16） ────────────────────────────────────────────

/**
 * HLS プレイリスト URL を受け取り、FFmpeg で MP4 に変換してダウンロードフォルダに保存する。
 *
 * メッセージ形式:
 *   { type: "convert", requestId, playlistUrl, referer?, outputName }
 *
 * 進捗通知（変換中に複数回送信）:
 *   { requestId, type: "progress", phase: "converting", percent: 0-100 }
 *
 * 完了通知:
 *   { requestId, ok: true, filePath }
 *
 * エラー時:
 *   { requestId, ok: false, error }
 *
 * FFmpeg コマンド例:
 *   ffmpeg -headers "Referer: https://example.com/\r\nOrigin: https://example.com\r\nUser-Agent: Mozilla/5.0...\r\n"
 *          -allowed_extensions ALL
 *          -i "https://cdn.example.com/stream/1080p.m3u8"
 *          -c copy "/Users/user/Downloads/stream.mp4"
 *
 * -allowed_extensions ALL は .key ファイルなど m3u8 内で参照される拡張子を
 * すべて許可するために必要。FFmpeg はデフォルトで未知の拡張子を拒否する。
 *
 * FFmpeg のデフォルト User-Agent は "Lavf/x.y.z" であり、Referer しか
 * 送らないと一部 CDN の anti-leech 判定に弾かれ、m3u8 の代わりにエラー
 * ページ等が返って "Invalid data found when processing input" で失敗する。
 * そのため Referer に加えて Origin（Referer から導出）と、呼び出し元の
 * ブラウザの User-Agent も一緒に送ってブラウザからのリクエストに近づける。
 *
 * @param {object} msg
 * @param {string} msg.requestId   - リクエスト ID（進捗/完了通知に添付）
 * @param {string} msg.playlistUrl - HLS Master / Media Playlist の URL
 * @param {string} [msg.referer]   - Referer ヘッダーとして付与するページ URL
 * @param {string} [msg.userAgent] - User-Agent ヘッダーとして付与する値
 * @param {string} msg.outputName  - 保存ファイル名（例: "stream.mp4"）
 */

/**
 * Referer / Origin / User-Agent から ffmpeg -headers 用の文字列を組み立てる。
 * 何も渡されなければ "" を返す（= -headers を付けない）。
 */
function buildFfmpegHeaders(referer, userAgent) {
  let origin = "";
  if (referer) {
    try { origin = new URL(referer).origin; } catch (_) { /* 不正 URL は無視 */ }
  }

  const lines = [
    ...(referer   ? [`Referer: ${referer}`]      : []),
    ...(origin    ? [`Origin: ${origin}`]        : []),
    ...(userAgent ? [`User-Agent: ${userAgent}`] : []),
  ];

  return lines.length ? lines.join("\r\n") + "\r\n" : "";
}

async function handleConvert({ requestId, playlistUrl, referer, userAgent, outputName }) {
  if (!playlistUrl) {
    sendMessage({ requestId, ok: false, error: "playlistUrl is required" });
    return;
  }

  // ── 出力先: ユーザーの Downloads フォルダ ────────────────────────────────
  const downloadsDir = getDownloadsDir();
  // ファイル名のサニタイズ（OS で使えない文字を除去）
  const safeOutputName = (outputName || "output.mp4")
    .replace(/[/\\:*?"<>|]/g, "_");
  const outputPath = path.join(downloadsDir, safeOutputName);

  const headers = buildFfmpegHeaders(referer, userAgent);

  // ── FFmpeg 引数を構築 ────────────────────────────────────────────────────
  const args = [
    "-y",   // 既存ファイルを上書き（確認なし）
    // Referer / Origin / User-Agent ヘッダー（セグメント・キーファイルの
    // リクエストにも適用される）
    ...(headers ? ["-headers", headers] : []),
    // .key など m3u8 が参照するすべての拡張子を許可
    "-allowed_extensions", "ALL",
    // リモートのプレイリストのみ扱うため file は許可しない。
    // file を入れると悪意ある m3u8 が file:///... をセグメント参照して
    // ローカルファイルを読み出せてしまう（LFI）。crypto は AES-128 復号に必要。
    "-protocol_whitelist", "http,https,tcp,tls,crypto",
    "-i", playlistUrl,
    // コーデックはコピー（再エンコードなし → 高速）
    "-c", "copy",
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    let ffmpeg;
    try {
      ffmpeg = spawn(FFMPEG, args);
    } catch (err) {
      sendMessage({ requestId, ok: false, error: `ffmpeg の起動に失敗: ${err.message}` });
      resolve(); // reject するとトップレベル catch でもう一度エラー送信される
      return;
    }

    // FFmpeg の進捗は stderr に出力される
    let stderrBuf      = "";
    let durationSec    = 0;
    let lastPercentage = -1;

    ffmpeg.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();

      // 総再生時間を1回だけ取得（Duration: hh:mm:ss.xx）
      if (durationSec === 0) {
        const durMatch = stderrBuf.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (durMatch) {
          durationSec = parseInt(durMatch[1]) * 3600
                      + parseInt(durMatch[2]) * 60
                      + parseFloat(durMatch[3]);
        }
      }

      // 現在の処理位置（time=hh:mm:ss.xx）から進捗率を計算
      const timeMatches = [...stderrBuf.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
      if (timeMatches.length > 0 && durationSec > 0) {
        const last = timeMatches[timeMatches.length - 1];
        const currentSec = parseInt(last[1]) * 3600
                         + parseInt(last[2]) * 60
                         + parseFloat(last[3]);
        const percent = Math.min(99, Math.round(currentSec / durationSec * 100));

        // 値が変わった時だけ通知（送信頻度を抑える）
        if (percent !== lastPercentage) {
          lastPercentage = percent;
          sendMessage({ requestId, type: "progress", phase: "converting", percent });
        }

        // バッファが肥大化しないようにトリム（末尾 500 文字を保持）
        if (stderrBuf.length > 1000) {
          stderrBuf = stderrBuf.slice(-500);
        }
      }
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        const errDetail = stderrBuf.slice(-300); // エラーの最後の部分を返す
        sendMessage({
          requestId,
          ok:    false,
          error: `ffmpeg が終了コード ${code} で失敗しました。\n${errDetail}`,
        });
        resolve();
        return;
      }

      // 変換完了 → 保存先パスを返す
      sendMessage({ requestId, ok: true, filePath: outputPath });
      resolve();
    });

    ffmpeg.on("error", (err) => {
      const msg = err.code === "ENOENT"
        ? "ffmpeg が見つかりません。PATH に ffmpeg を追加してください。"
        : `ffmpeg の実行エラー: ${err.message}`;
      sendMessage({ requestId, ok: false, error: msg });
      resolve();
    });
  });
}

module.exports = handleConvert;
module.exports.buildFfmpegHeaders = buildFfmpegHeaders;
