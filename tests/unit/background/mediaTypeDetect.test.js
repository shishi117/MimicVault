// tests/unit/background/mediaTypeDetect.test.js — MimicVault
// isHlsUrl/isDashUrl/isTsUrl/isHlsOrDashUrl の単体テスト（未テストの純粋ロジック関数）。
// 実行: npx vitest run tests/unit/background/mediaTypeDetect.test.js

"use strict";

const assert = require("assert");
const { isHlsUrl, isDashUrl, isTsUrl, isHlsOrDashUrl } = require("../../../background/mediaTypeDetect");

test("isHlsUrl: URL拡張子(.m3u8)またはMIMEでHLSを判定する", () => {
  assert.ok(isHlsUrl("https://h/v.m3u8", ""), "拡張子 .m3u8");
  assert.ok(isHlsUrl("https://h/v?x=1", "application/vnd.apple.mpegurl"), "MIME に mpegurl を含む");
  assert.ok(!isHlsUrl("https://h/v.mp4", "video/mp4"), "無関係な URL/MIME は false");
});

test("isDashUrl: URL拡張子(.mpd)またはMIMEでDASH(MPD)を判定する", () => {
  assert.ok(isDashUrl("https://h/v.mpd", ""), "拡張子 .mpd");
  assert.ok(isDashUrl("https://h/v?x=1", "application/dash+xml"), "MIME に dash+xml を含む");
  assert.ok(!isDashUrl("https://h/v.m3u8", ""), "HLS は DASH ではない");
});

test("isTsUrl: URL拡張子(.ts)またはMIMEでHLSセグメントを判定する", () => {
  assert.ok(isTsUrl("https://h/seg.ts", ""), "拡張子 .ts");
  assert.ok(isTsUrl("https://h/seg?x=1", "video/mp2t"), "MIME に mp2t を含む");
  assert.ok(!isTsUrl("https://h/seg.m4s", ""), ".m4s は ts ではない");
});

test("isHlsOrDashUrl: HLSまたはDASHのいずれかに一致すればtrue", () => {
  assert.ok(isHlsOrDashUrl("https://h/v.m3u8", ""), "HLS は true");
  assert.ok(isHlsOrDashUrl("https://h/v.mpd", ""), "DASH も true");
  assert.ok(!isHlsOrDashUrl("https://h/v.mp4", "video/mp4"), "どちらでもなければ false");
});
