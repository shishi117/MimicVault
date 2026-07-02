/**
 * companion/app.js — MimicVault Native Messaging companion app
 *
 * Firefox 拡張機能と stdin/stdout の 4バイト length-prefix JSON フレーミングで通信する。
 * 実処理は lib/*.js に分割（io / ffmpeg / handleMessage / handleConvert / handleMux）。
 *
 * 対応コマンド: ping / version / convert / mux
 */

"use strict";

const { sendMessage }  = require("./lib/io");
const handleMessage    = require("./lib/handleMessage");

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
