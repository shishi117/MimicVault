// companion/lib/handleRemux.js — MimicVault
// 結合済み断片(単一入力)を MP4 に remux する handleRemux
"use strict";

const { spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { sendMessage } = require("./io");
const { FFMPEG, getDownloadsDir } = require("./ffmpeg");

// ─── 収集ストリーム remux（v0.19.0） ─────────────────────────────────────────
/**
 * 結合済みの fMP4/TS 断片（init+moof… を連結した単一入力）を、
 * FFmpeg で正規の progressive MP4 に remux して Downloads フォルダへ保存する。
 * 入力は次のどちらかで渡す:
 *   - inputB64:  バイト列を base64 化したもの（小さい入力向け。一時ファイルに書き出す）
 *   - inputPath: 既にディスク上にある入力ファイルの絶対パス（大きい入力向け。
 *                Native Messaging 経由でバイト列をやり取りしないため、
 *                数百MB〜の HLS VOD 等でもメモリ・速度の問題が起きない）
 *
 * メッセージ形式:
 *   { type: "remux", requestId, inputB64?, inputPath?, outputName }
 *
 * FFmpeg コマンド:
 *   ffmpeg -y -i <input> -c copy -movflags +faststart output.mp4
 */
async function handleRemux({ requestId, inputB64, inputPath, outputName }) {
  if (!inputB64 && !inputPath) {
    sendMessage({ requestId, ok: false, error: "inputB64 or inputPath is required" });
    return;
  }

  const tmpDir       = os.tmpdir();
  const downloadsDir = getDownloadsDir();
  const safeOutput   = (outputName || "output.mp4").replace(/[/\\:*?"<>|]/g, "_");
  const outputPath   = path.join(downloadsDir, safeOutput);

  // inputPath 指定時はディスク上の既存ファイルをそのまま使う（一時ファイル作成なし）。
  // inputB64 指定時のみ、従来通り一時ファイルに書き出して使う。
  let input = inputPath;
  const isTmpInput = !inputPath;
  if (isTmpInput) {
    input = path.join(tmpDir, `ms_remux_${requestId}.mp4`);
    try {
      fs.writeFileSync(input, Buffer.from(inputB64, "base64"));
    } catch (err) {
      sendMessage({ requestId, ok: false, error: `tmp write failed: ${err.message}` });
      return;
    }
  }

  const args = ["-y", "-i", input, "-c", "copy", "-movflags", "+faststart", outputPath];

  return new Promise((resolve) => {
    let ffmpeg;
    try {
      ffmpeg = spawn(FFMPEG, args);
    } catch (err) {
      cleanup();
      sendMessage({ requestId, ok: false, error: `ffmpeg 起動失敗: ${err.message}` });
      resolve();
      return;
    }

    let stderrBuf   = "";
    let durationSec = 0;
    let lastPct     = -1;

    ffmpeg.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();

      if (durationSec === 0) {
        const d = stderrBuf.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (d) durationSec = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]);
      }
      const times = [...stderrBuf.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
      if (times.length > 0 && durationSec > 0) {
        const t = times[times.length - 1];
        const cur = (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]);
        const pct = Math.min(99, Math.round(cur / durationSec * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          sendMessage({ requestId, type: "progress", phase: "remux", percent: pct });
        }
        if (stderrBuf.length > 1000) stderrBuf = stderrBuf.slice(-500);
      }
    });

    ffmpeg.on("close", (code) => {
      cleanup();
      if (code !== 0) sendMessage({ requestId, ok: false, error: `ffmpeg remux 失敗 (code ${code})` });
      else            sendMessage({ requestId, ok: true, filePath: outputPath });
      resolve();
    });

    ffmpeg.on("error", (err) => {
      cleanup();
      const m = err.code === "ENOENT"
        ? "ffmpeg が見つかりません。PATH に ffmpeg を追加してください。"
        : `ffmpeg エラー: ${err.message}`;
      sendMessage({ requestId, ok: false, error: m });
      resolve();
    });

    function cleanup() {
      // inputPath はユーザーが保存したファイル（.ts 等）なので削除しない。
      // 一時ファイルを作った場合（inputB64 経由）のみ削除する。
      if (isTmpInput) { try { fs.unlinkSync(input); } catch (_) {} }
    }
  });
}

module.exports = handleRemux;
