// companion/lib/handleMessage.js — MimicVault
// コマンドディスパッチャ handleMessage
"use strict";

const { sendMessage } = require("./io");
const { getFfmpegVersion } = require("./ffmpeg");
const handleConvert = require("./handleConvert");
const handleMux = require("./handleMux");

// ─── コマンドディスパッチャ ───────────────────────────────────────────────────

async function handleMessage(msg) {
  const { type, requestId } = msg;

  switch (type) {

    // ── ping: 疎通確認 ─────────────────────────────────────────────────────
    case "ping":
      sendMessage({ requestId, ok: true, pong: true, version: "1.0.0" });
      break;

    // ── version: Node.js / FFmpeg バージョン情報 ────────────────────────────
    case "version": {
      const ffmpegVersion = await getFfmpegVersion();
      sendMessage({
        requestId,
        ok:      true,
        node:    process.version,
        ffmpeg:  ffmpegVersion ?? null, // null = ffmpeg が見つからない
      });
      break;
    }

    // ── convert: HLS → MP4 変換（ステップ16）──────────────────────────────
    case "convert":
      await handleConvert(msg);
      break;

    // ── mux: DASH 映像+音声 → MP4 結合（v0.18.0）──────────────────────────
    case "mux":
      await handleMux(msg);
      break;

    default:
      sendMessage({ requestId, ok: false, error: `unknown command: ${type}` });
  }
}

module.exports = handleMessage;
