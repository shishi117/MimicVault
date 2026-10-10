// companion/lib/handleConcatParts.js — MimicVault
// 分割DLの一時パートファイルを単純連結する handleConcatParts
"use strict";

const fs   = require("fs");
const path = require("path");
const { sendMessage } = require("./io");
const { getDownloadsDir } = require("./ffmpeg");

// ─── 分割DLパート結合（ディスク退避版 downloadDirectRanged 用） ────────────────
/**
 * downloadDirectRanged.js が Range 分割取得した各パートを、ディスク上の
 * 一時ファイルのまま受け取り、順番通りにバイト列を連結して Downloads
 * フォルダへ保存する。
 *
 * 各パートは元ファイルの連続したバイト範囲そのもの（コンテナを問わず
 * 単純な byte 列）なので、mux/remux と違い FFmpeg によるコンテナ変換は
 * 不要。fs ストリームでの素の連結のみで済む。
 *
 * メッセージ形式:
 *   { type: "concatParts", requestId, inputPaths: string[], outputName }
 *
 * 完了通知:
 *   { requestId, ok: true, filePath }
 *
 * @param {object} msg
 */
async function handleConcatParts({ requestId, inputPaths, outputName }) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    sendMessage({ requestId, ok: false, error: "inputPaths is required" });
    return;
  }

  const downloadsDir = getDownloadsDir();
  const safeOutput    = (outputName || "output.mp4").replace(/[/\\:*?"<>|]/g, "_");
  const outputPath     = path.join(downloadsDir, safeOutput);

  try {
    await concatFiles(inputPaths, outputPath);
  } catch (err) {
    sendMessage({ requestId, ok: false, error: `結合失敗: ${err.message}` });
    return;
  }

  // パートファイルは分割DL専用の一時物なので、結合が終わったら削除する
  // （mux/remux の inputPath と違い、ユーザー自身が保存したファイルではない）。
  for (const p of inputPaths) {
    try { fs.unlinkSync(p); } catch (_) {}
  }

  sendMessage({ requestId, ok: true, filePath: outputPath });
}

/**
 * inputPaths を渡された順番通りに outputPath へストリームで連結する。
 * 全体を一度にメモリへ読み込まず、ファイルごとに読み込み→書き込みを
 * 直列に行うことで、パート数やサイズに関わらずメモリ使用量を一定に保つ。
 */
function concatFiles(inputPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    out.on("error", reject);

    (function next(i) {
      if (i >= inputPaths.length) { out.end(resolve); return; }
      const inStream = fs.createReadStream(inputPaths[i]);
      inStream.on("error", reject);
      inStream.on("end", () => next(i + 1));
      inStream.pipe(out, { end: false });
    })(0);
  });
}

module.exports = handleConcatParts;
module.exports.concatFiles = concatFiles;
