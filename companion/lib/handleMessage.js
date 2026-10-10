// companion/lib/handleMessage.js — MimicVault
// コマンドディスパッチャ handleMessage
"use strict";

const { sendMessage } = require("./io");
const { getFfmpegVersion } = require("./ffmpeg");
const handleConvert = require("./handleConvert");
const handleMux = require("./handleMux");
const handleRemux = require("./handleRemux");
const handleConcatParts = require("./handleConcatParts");

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

    // ── remux: 収集ストリーム(単一入力) → MP4（v0.19.0）───────────────────
    case "remux":
      await handleRemux(msg);
      break;

    // ── concatParts: 分割DLパート(ディスク上の一時ファイル群) → 単純連結 ────
    case "concatParts":
      await handleConcatParts(msg);
      break;

    default:
      sendMessage({ requestId, ok: false, error: `unknown command: ${type}` });
  }
}

module.exports = handleMessage;
