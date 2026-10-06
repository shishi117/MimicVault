// companion/lib/handleConvert.test.js — MimicVault
// buildFfmpegHeaders の自己チェック。実行: node companion/lib/handleConvert.test.js

"use strict";

const assert = require("assert");
const { buildFfmpegHeaders } = require("./handleConvert");

assert.strictEqual(
  buildFfmpegHeaders("https://example.com/video/1"),
  "Referer: https://example.com/video/1\r\nOrigin: https://example.com\r\nAccept: */*\r\nSec-Fetch-Mode: cors\r\nSec-Fetch-Dest: empty\r\nSec-Fetch-Site: cross-site\r\n",
  "referer あり → Referer/Origin + ブラウザ標準ヘッダーを含む"
);
assert.strictEqual(
  buildFfmpegHeaders(""),
  "Accept: */*\r\nSec-Fetch-Mode: cors\r\nSec-Fetch-Dest: empty\r\nSec-Fetch-Site: cross-site\r\n",
  "referer なし → ブラウザ標準ヘッダーのみ"
);
assert.strictEqual(
  buildFfmpegHeaders("not a url"),
  "Referer: not a url\r\nAccept: */*\r\nSec-Fetch-Mode: cors\r\nSec-Fetch-Dest: empty\r\nSec-Fetch-Site: cross-site\r\n",
  "referer が URL として不正でも Origin を省いて続行する"
);

console.log("handleConvert.test.js: OK");
