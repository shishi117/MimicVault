// companion/lib/ffmpeg.js — MimicVault
// FFmpeg パス解決・バージョン取得・保存先フォルダ
"use strict";

const { execFile } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

/**
 * 使用する ffmpeg の実行パスを決める。
 *
 * 配布形態（依存ゼロ exe）では companion 実行ファイルと同じフォルダに
 * ffmpeg(.exe) を同梱する。process.execPath はコンパイル済み exe 自身の
 * パスを指す（Bun/pkg いずれも同様。__dirname はスナップショット仮想パスに
 * なるため使わない）。
 *
 * 同梱 ffmpeg が無ければ PATH 上の "ffmpeg" にフォールバックする
 * （開発時に `node app.js` で動かす場合など）。
 */
function resolveFfmpegPath() {
  const exeDir   = path.dirname(process.execPath);
  const exeName  = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const bundled  = path.join(exeDir, exeName);
  try {
    if (fs.statSync(bundled).isFile()) return bundled;
  } catch (_) { /* 同梱なし → PATH フォールバック */ }
  return "ffmpeg";
}

const FFMPEG = resolveFfmpegPath();

/**
 * ffmpeg -version を実行してバージョン文字列を返す。
 * ffmpeg が見つからない場合は null を返す（例外はスローしない）。
 */
function getFfmpegVersion() {
  return new Promise((resolve) => {
    execFile(FFMPEG, ["-version"], { timeout: 8000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const match = stdout.match(/ffmpeg version ([^\s]+)/);
      resolve(match ? match[1] : "unknown");
    });
  });
}

/**
 * OS ごとのダウンロードフォルダのパスを返す。
 * 存在しない場合はホームディレクトリにフォールバック。
 */
function getDownloadsDir() {
  const home      = os.homedir();
  const downloads = path.join(home, "Downloads");
  try {
    if (fs.statSync(downloads).isDirectory()) return downloads;
  } catch (_) {}
  return home;
}

/**
 * -allowed_segment_extensions（比較的新しい FFmpeg の hls demuxer オプション）
 * に対応しているかを判定する。古い FFmpeg では "Unrecognized option" で
 * 起動自体が失敗するため、渡す前に確認する必要がある。
 * プロセス内でキャッシュし、以後は ffmpeg を再実行しない。
 */
let cachedSupportsSegExt = null;
function supportsAllowedSegmentExtensions() {
  if (cachedSupportsSegExt !== null) return Promise.resolve(cachedSupportsSegExt);
  return new Promise((resolve) => {
    execFile(FFMPEG, ["-hide_banner", "-h", "demuxer=hls"], { timeout: 8000 }, (err, stdout, stderr) => {
      cachedSupportsSegExt = !err && /allowed_segment_extensions/.test(stdout + stderr);
      resolve(cachedSupportsSegExt);
    });
  });
}

module.exports = { FFMPEG, getFfmpegVersion, getDownloadsDir, supportsAllowedSegmentExtensions };
