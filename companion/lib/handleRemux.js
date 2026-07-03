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
 * 結合済みの fMP4/TS 断片（init+moof… を連結した単一入力）を base64 で受け取り、
 * FFmpeg で正規の progressive MP4 に remux して Downloads フォルダへ保存する。
 *
 * メッセージ形式:
 *   { type: "remux", requestId, inputB64, outputName }
 *
 * FFmpeg コマンド:
 *   ffmpeg -y -i input_tmp.mp4 -c copy -movflags +faststart output.mp4
 */
async function handleRemux({ requestId, inputB64, outputName }) {
  if (!inputB64) {
    sendMessage({ requestId, ok: false, error: "inputB64 is required" });
    return;
  }

  const tmpDir       = os.tmpdir();
  const inputTmp     = path.join(tmpDir, `ms_remux_${requestId}.mp4`);
  const downloadsDir = getDownloadsDir();
  const safeOutput   = (outputName || "output.mp4").replace(/[/\\:*?"<>|]/g, "_");
  const outputPath   = path.join(downloadsDir, safeOutput);

  try {
    fs.writeFileSync(inputTmp, Buffer.from(inputB64, "base64"));
  } catch (err) {
    sendMessage({ requestId, ok: false, error: `tmp write failed: ${err.message}` });
    return;
  }

  const args = ["-y", "-i", inputTmp, "-c", "copy", "-movflags", "+faststart", outputPath];

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
      try { fs.unlinkSync(inputTmp); } catch (_) {}
    }
  });
}

module.exports = handleRemux;
