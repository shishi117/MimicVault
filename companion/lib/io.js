// companion/lib/io.js — MimicVault
// Native Messaging フレーミング送信 sendMessage
"use strict";

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

module.exports = { sendMessage };
