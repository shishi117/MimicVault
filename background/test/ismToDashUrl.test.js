// background/test/ismToDashUrl.test.js — MimicVault
// ismToDashCandidates / isMssUrl の自己チェック。実行: node background/test/ismToDashUrl.test.js

"use strict";

const assert = require("assert");
const { isMssUrl, ismToDashCandidates } = require("../ismToDashUrl");

// ── isMssUrl ──────────────────────────────────────────────────────────────
assert.ok(isMssUrl("https://h/p/video.ism/Manifest"),            "大文字 Manifest");
assert.ok(isMssUrl("https://h/p/video.ism/manifest"),            "小文字 manifest");
assert.ok(isMssUrl("https://h/p/video.isml/manifest"),           ".isml も MSS");
assert.ok(isMssUrl("https://h/p/v.ism/manifest(format=m3u8-aapl)"), "format 付き");
assert.ok(isMssUrl("https://h/p/v.ism/Manifest?token=x"),        "クエリ付き");
assert.ok(isMssUrl("https://h/whatever", "application/vnd.ms-sstr+xml"), "MIME で判定");
assert.ok(!isMssUrl("https://h/p/video.mpd"),                    "DASH は MSS でない");
assert.ok(!isMssUrl("https://h/p/index.m3u8"),                   "HLS は MSS でない");
assert.ok(!isMssUrl("https://h/p/v.ism/QualityLevels(400000)/Fragments(video=0)"), "断片 URL は MSS 判定外");

// ── ismToDashCandidates ─────────────────────────────────────────────────────
assert.deepStrictEqual(
  ismToDashCandidates("https://h/p/video.ism/Manifest"),
  [
    "https://h/p/video.ism/.mpd",
    "https://h/p/video.ism/manifest(format=mpd-time-csf)",
    "https://h/p/video.ism/manifest.mpd",
  ],
  "大文字 Manifest → 3 記法の候補"
);
assert.deepStrictEqual(
  ismToDashCandidates("https://h/p/video.ism/manifest(format=m3u8-aapl)?t=1"),
  [
    "https://h/p/video.ism/.mpd?t=1",
    "https://h/p/video.ism/manifest(format=mpd-time-csf)?t=1",
    "https://h/p/video.ism/manifest.mpd?t=1",
  ],
  "既存 format を差し替え、クエリを保持"
);
assert.deepStrictEqual(
  ismToDashCandidates("https://h/p/video.mpd"),
  ["https://h/p/video.mpd"],
  "MSS でない URL は元 URL 1 件のみ"
);

console.log("ismToDashUrl.test.js: OK");
