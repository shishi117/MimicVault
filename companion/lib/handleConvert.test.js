// companion/lib/handleConvert.test.js — MimicVault
// buildFfmpegHeaders の自己チェック。実行: node companion/lib/handleConvert.test.js

"use strict";

const assert = require("assert");
const { buildFfmpegHeaders } = require("./handleConvert");

assert.strictEqual(
  buildFfmpegHeaders("https://example.com/video/1", "UA/1.0"),
  "Referer: https://example.com/video/1\r\nOrigin: https://example.com\r\nUser-Agent: UA/1.0\r\n",
  "referer + userAgent → Referer/Origin/User-Agent をすべて含む"
);
assert.strictEqual(
  buildFfmpegHeaders("", ""),
  "",
  "両方なし → 空文字（-headers を付けない）"
);
assert.strictEqual(
  buildFfmpegHeaders("not a url", "UA/1.0"),
  "Referer: not a url\r\nUser-Agent: UA/1.0\r\n",
  "referer が URL として不正でも Origin を省いて続行する"
);

console.log("handleConvert.test.js: OK");
