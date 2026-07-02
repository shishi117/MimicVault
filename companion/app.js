/**
 * companion/app.js  (v0.16.0 — ステップ15/16)
 *
 * Media Snatcher Native Messaging companion app。
 * Firefox 拡張機能と stdin/stdout の 4バイト length-prefix JSON フレーミングで通信する。
 *
 * 対応コマンド:
 *   ping    — 疎通確認。{ pong: true, version } を返す
 *   version — Node.js / FFmpeg バージョンを返す
 *   convert — HLS プレイリスト URL を FFmpeg で MP4 に変換して保存する
 *
 * メッセージ形式:
 *   入力: 4バイト LE 長さ + JSON（{ type, requestId, ...params }）
 *   出力: 4バイト LE 長さ + JSON（{ requestId, ok, ...result }）
 *         変換中は進捗メッセージ（{ requestId, type:"progress", ... }）を複数送信する
 */

"use strict";

const { execFile, spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ─── FFmpeg パス解決 ──────────────────────────────────────────────────────────
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

// ─── Native Messaging フレーミング ────────────────────────────────────────────

let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processInput();
});

process.stdin.on("end", () => {
  // Firefox が終了 or 拡張機能が切断 → プロセスを終了
  process.exit(0);
});

/**
 * 受信バッファから完全なメッセージを取り出して処理する。
 * 複数メッセージが一度に届く場合も正しく処理できるようループする。
 */
function processInput() {
  while (inputBuffer.length >= 4) {
    const size = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + size) break; // メッセージが揃っていない
    const jsonBuf = inputBuffer.slice(4, 4 + size);
    inputBuffer   = inputBuffer.slice(4 + size);
    let msg;
    try {
      msg = JSON.parse(jsonBuf.toString("utf8"));
    } catch (_) {
      continue; // JSON パースエラーは無視して次へ
    }
    handleMessage(msg).catch((err) => {
      // トップレベルで catch してクラッシュを防ぐ
      sendMessage({ requestId: msg?.requestId, ok: false, error: err.message });
    });
  }
}

/**
 * JSON メッセージを length-prefix 形式でエンコードして stdout に書き出す。
 * Firefox の Native Messaging プロトコル仕様（4バイト LE + UTF-8 JSON）。
 */
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, "utf8");
  const len  = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([len, body]));
}

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

// ─── FFmpeg バージョン取得 ────────────────────────────────────────────────────

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
 *   ffmpeg -headers "Referer: https://example.com/\r\n"
 *          -allowed_extensions ALL
 *          -i "https://cdn.example.com/stream/1080p.m3u8"
 *          -c copy "/Users/user/Downloads/stream.mp4"
 *
 * -allowed_extensions ALL は .key ファイルなど m3u8 内で参照される拡張子を
 * すべて許可するために必要。FFmpeg はデフォルトで未知の拡張子を拒否する。
 *
 * @param {object} msg
 * @param {string} msg.requestId   - リクエスト ID（進捗/完了通知に添付）
 * @param {string} msg.playlistUrl - HLS Master / Media Playlist の URL
 * @param {string} [msg.referer]   - Referer ヘッダーとして付与するページ URL
 * @param {string} msg.outputName  - 保存ファイル名（例: "stream.mp4"）
 */
async function handleConvert({ requestId, playlistUrl, referer, outputName }) {
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

  // ── FFmpeg 引数を構築 ────────────────────────────────────────────────────
  const args = [
    "-y",   // 既存ファイルを上書き（確認なし）
    // Referer ヘッダー（セグメント・キーファイルのリクエストにも適用される）
    ...(referer ? ["-headers", `Referer: ${referer}\r\n`] : []),
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
