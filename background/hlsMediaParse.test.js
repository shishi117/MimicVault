// background/hlsMediaParse.test.js — MimicVault
// EXT-X-MAP(fMP4初期化セグメント)解析の自己チェック。実行: node background/hlsMediaParse.test.js

"use strict";

const assert = require("assert");
const { parseMediaPlaylist } = require("./hlsMediaParse");

const BASE = "https://cdn.example/video/";

// ── 従来の MPEG-TS プレイリスト（EXT-X-MAP 無し）── initUri は null ───────────
const tsPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg0.ts
#EXTINF:6.0,
seg1.ts
#EXT-X-ENDLIST
`;
const tsResult = parseMediaPlaylist(tsPlaylist, BASE);
assert.strictEqual(tsResult.initUri, null, "EXT-X-MAP が無ければ initUri は null");
assert.strictEqual(tsResult.segments.length, 2, "セグメントは2つ");

// ── fMP4(CMAF) プレイリスト（EXT-X-MAP あり）── initUri を絶対URLで取得 ───────
const fmp4Playlist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
seg0.m4s
#EXTINF:6.0,
seg1.m4s
#EXT-X-ENDLIST
`;
const fmp4Result = parseMediaPlaylist(fmp4Playlist, BASE);
assert.strictEqual(fmp4Result.initUri, BASE + "init.mp4", "EXT-X-MAP の URI を相対→絶対URLに解決する");
assert.strictEqual(fmp4Result.segments.length, 2, "セグメントは2つ（init はカウントしない）");

console.log("hlsMediaParse.test.js: OK");
