// companion/lib/handleConvert.js — MimicVault
// HLS → MP4 変換 handleConvert
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { sendMessage } = require("./io");
const { FFMPEG, getDownloadsDir, supportsAllowedSegmentExtensions } = require("./ffmpeg");

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
 *   ffmpeg -user_agent "Mozilla/5.0..."
 *          -headers "Referer: https://example.com/\r\nOrigin: https://example.com\r\nAccept: *\/*\r\nSec-Fetch-Mode: cors\r\nSec-Fetch-Dest: empty\r\nSec-Fetch-Site: cross-site\r\n"
 *          -allowed_extensions ALL
 *          -i "https://cdn.example.com/stream/1080p.m3u8"
 *          -c copy "/Users/user/Downloads/stream.mp4"
 *
 * -allowed_extensions ALL は .key ファイルなど m3u8 内で参照される拡張子を
 * すべて許可するために必要。FFmpeg はデフォルトで未知の拡張子を拒否する。
 * 新しめの FFmpeg はセグメント本体にも別枠で -allowed_segment_extensions
 * という拡張子チェックを持つ（対応している場合のみ ALL を付与する。
 * supportsAllowedSegmentExtensions 参照）。これが無いと、セグメントを
 * .jpeg 等に偽装する配信元（surrit.com 等）で
 * "URL ... is not in allowed_segment_extensions" → 変換失敗になる。
 *
 * FFmpeg は常に自前の User-Agent ヘッダー（既定 "Lavf/x.y.z"）を送るため、
 * -headers に "User-Agent: ..." を混ぜると2本の User-Agent ヘッダーが
 * 送られてしまい上書きにならない。そのため専用の -user_agent オプションを
 * 使う。また一部 CDN の anti-leech は Referer/Origin だけでなく、実ブラウザの
 * fetch() が付ける Sec-Fetch-* 等の有無もチェックしてくるため、ブラウザの
 * DevTools で確認できた実際のリクエストに合わせて固定値で付与する。
 *
 * @param {object} msg
 * @param {string} msg.requestId   - リクエスト ID（進捗/完了通知に添付）
 * @param {string} msg.playlistUrl - HLS Master / Media Playlist の URL
 * @param {string} [msg.referer]   - Referer ヘッダーとして付与するページ URL
 * @param {string} [msg.userAgent] - -user_agent に渡す User-Agent 値
 * @param {string} msg.outputName  - 保存ファイル名（例: "stream.mp4"）
 */

/**
 * Referer / Origin とブラウザ fetch() 標準ヘッダーから
 * ffmpeg -headers 用の文字列を組み立てる。
 */
function buildFfmpegHeaders(referer) {
  let origin = "";
  if (referer) {
    try { origin = new URL(referer).origin; } catch (_) { /* 不正 URL は無視 */ }
  }

  const lines = [
    ...(referer ? [`Referer: ${referer}`] : []),
    ...(origin  ? [`Origin: ${origin}`]   : []),
    "Accept: */*",
    "Sec-Fetch-Mode: cors",
    "Sec-Fetch-Dest: empty",
    "Sec-Fetch-Site: cross-site",
  ];

  return lines.join("\r\n") + "\r\n";
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

  // 新しめの FFmpeg は allowed_extensions と別にセグメント本体用の拡張子
  // チェックを持つ（既定リストに .ts 等はあるが .jpeg 等の偽装拡張子は無い）。
  // 古い FFmpeg にはこのオプション自体が無く、渡すと起動自体が失敗するため
  // 対応状況を確認してから付ける。
  const segExtArg = (await supportsAllowedSegmentExtensions())
    ? ["-allowed_segment_extensions", "ALL"]
    : [];

  // ── FFmpeg 引数を構築 ────────────────────────────────────────────────────
  const args = [
    "-y",   // 既存ファイルを上書き（確認なし）
    // User-Agent は専用オプションで上書き（-headers に混ぜると重複する）
    ...(userAgent ? ["-user_agent", userAgent] : []),
    // Referer / Origin / Sec-Fetch-* ヘッダー（セグメント・キーファイルの
    // リクエストにも適用される）
    "-headers", buildFfmpegHeaders(referer),
    // .key など m3u8 が参照するすべての拡張子を許可
    "-allowed_extensions", "ALL",
    ...segExtArg,
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
