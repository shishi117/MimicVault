// background/mediaStore.test.js — MimicVault
// addToStore の「直接DLアイテムは検出しない」フィルタの自己チェック。
// 実行: node background/mediaStore.test.js

"use strict";

const assert = require("assert");

// mediaStore.js が参照するグローバルをスタブしてから読み込む
global.browser = {
  browserAction: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
};
global.isMssUrl = require("./ismToDashUrl").isMssUrl;
const { addToStore, getStore } = require("./mediaStore");

const TAB = 1;

// ── 直接ファイル（mp4 等）は検出しない ───────────────────────────────────────
assert.strictEqual(
  addToStore(TAB, { url: "https://h/video.mp4", mimeHint: "video/mp4" }),
  false,
  "mp4 直リンクは追加されない"
);
assert.strictEqual(getStore(TAB).size, 0, "mp4 はストアに入らない");

// ── HLS / DASH は検出する ───────────────────────────────────────────────────
assert.strictEqual(
  addToStore(TAB, { url: "https://h/video.m3u8", mimeHint: "" }),
  true,
  "m3u8 は追加される"
);
assert.strictEqual(
  addToStore(TAB, { url: "https://h/video.mpd", mimeHint: "" }),
  true,
  "mpd は追加される"
);
// URL に拡張子が出ない場合でも mimeHint で判定
assert.strictEqual(
  addToStore(TAB, { url: "https://h/stream?x=1", mimeHint: "application/vnd.apple.mpegurl" }),
  true,
  "mimeHint が mpegurl なら追加される"
);
assert.strictEqual(getStore(TAB).size, 3, "HLS/DASH 系の3件のみストアに入る");

// ── 収集ストリーム（isSegmentGroup）は URL 形状を問わず検出する ──────────────
assert.strictEqual(
  addToStore(TAB, { url: "https://h/dir/", isSegmentGroup: true, mimeHint: "" }),
  true,
  "収集ストリームは追加される"
);

// ── MSS は DASH へ正規化されて検出する ──────────────────────────────────────
const TAB2 = 2;
assert.strictEqual(
  addToStore(TAB2, { url: "https://h/v.ism/Manifest", mimeHint: "" }),
  true,
  "MSS マニフェストは追加される"
);
const mssItem = getStore(TAB2).get("https://h/v.ism/Manifest");
assert.strictEqual(mssItem.mimeHint, "application/dash+xml", "MSS は dash+xml に正規化される");
assert.strictEqual(mssItem.viaMss, true, "viaMss フラグが立つ");

console.log("mediaStore.test.js: OK");
