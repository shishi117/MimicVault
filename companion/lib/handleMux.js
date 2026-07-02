// companion/lib/handleMux.js — MimicVault
// DASH 映像+音声 mux handleMux
"use strict";

const { spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { sendMessage } = require("./io");
const { FFMPEG, getDownloadsDir } = require("./ffmpeg");

// ─── DASH 映像+音声 mux（v0.18.0） ──────────────────────────────────────────
/**
 * 映像・音声を base64 で受け取り、一時ファイルに書き出してから
 * FFmpeg で MP4 に結合し、Downloads フォルダに保存する。
 *
 * メッセージ形式:
 *   { type: "mux", requestId, videoB64, audioB64, outputName }
 *
 * 進捗通知（mux フェーズ中に複数回送信）:
 *   { requestId, type: "progress", phase: "muxing", percent: 0-100 }
 *
 * 完了通知:
 *   { requestId, ok: true, filePath }
 *
 * FFmpeg コマンド:
 *   ffmpeg -y -i video_tmp.mp4 -i audio_tmp.m4a -c copy output.mp4
 *
 * @param {object} msg
 */
async function handleMux({ requestId, videoB64, audioB64, outputName }) {
  if (!videoB64 || !audioB64) {
    sendMessage({ requestId, ok: false, error: "videoB64 and audioB64 are required" });
    return;
  }

  const tmpDir      = os.tmpdir();
  const videoTmp    = path.join(tmpDir, `ms_video_${requestId}.mp4`);
  const audioTmp    = path.join(tmpDir, `ms_audio_${requestId}.m4a`);
  const downloadsDir = getDownloadsDir();
  const safeOutput  = (outputName || "output.mp4").replace(/[/\\:*?"<>|]/g, "_");
  const outputPath  = path.join(downloadsDir, safeOutput);

  // base64 → 一時ファイルに書き出す
  try {
    fs.writeFileSync(videoTmp, Buffer.from(videoB64, "base64"));
    fs.writeFileSync(audioTmp, Buffer.from(audioB64, "base64"));
  } catch (err) {
    sendMessage({ requestId, ok: false, error: `tmp write failed: ${err.message}` });
    return;
  }

  const args = [
    "-y",
    "-i", videoTmp,
    "-i", audioTmp,
    "-c", "copy",
    outputPath,
  ];

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

    let stderrBuf      = "";
    let durationSec    = 0;
    let lastPercentage = -1;

    ffmpeg.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();

      if (durationSec === 0) {
        const durMatch = stderrBuf.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (durMatch) {
          durationSec = parseInt(durMatch[1]) * 3600
                      + parseInt(durMatch[2]) * 60
                      + parseFloat(durMatch[3]);
        }
      }

      const timeMatches = [...stderrBuf.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
      if (timeMatches.length > 0 && durationSec > 0) {
        const last = timeMatches[timeMatches.length - 1];
        const currentSec = parseInt(last[1]) * 3600
                         + parseInt(last[2]) * 60
                         + parseFloat(last[3]);
        const percent = Math.min(99, Math.round(currentSec / durationSec * 100));
        if (percent !== lastPercentage) {
          lastPercentage = percent;
          sendMessage({ requestId, type: "progress", phase: "muxing", percent });
        }
        if (stderrBuf.length > 1000) stderrBuf = stderrBuf.slice(-500);
      }
    });

    ffmpeg.on("close", (code) => {
      cleanup();
      if (code !== 0) {
        sendMessage({ requestId, ok: false, error: `ffmpeg mux 失敗 (code ${code})` });
      } else {
        sendMessage({ requestId, ok: true, filePath: outputPath });
      }
      resolve();
    });

    ffmpeg.on("error", (err) => {
      cleanup();
      const msg = err.code === "ENOENT"
        ? "ffmpeg が見つかりません。PATH に ffmpeg を追加してください。"
        : `ffmpeg エラー: ${err.message}`;
      sendMessage({ requestId, ok: false, error: msg });
      resolve();
    });

    function cleanup() {
      try { fs.unlinkSync(videoTmp); } catch (_) {}
      try { fs.unlinkSync(audioTmp); } catch (_) {}
    }
  });
}

module.exports = handleMux;
