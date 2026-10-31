// tests/unit/background/mediaStore.test.js — MimicVault
// addToStore の検出フィルタ（HLS/DASH/収集ストリーム/直接ファイル）の自己チェック。
// 実行: npx vitest run tests/unit/background/mediaStore.test.js

"use strict";

const assert = require("assert");

// mediaStore.js が参照するグローバルをスタブしてから読み込む
global.browser = {
  browserAction: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
  tabs: {
    sendMessage: () => Promise.resolve(),
  },
};
global.isMssUrl = require("../../../background/ismToDashUrl").isMssUrl;
global.isHlsOrDashUrl = require("../../../background/mediaTypeDetect").isHlsOrDashUrl;
// background/constants.js の該当定数（拡張機能内では同一グローバルスコープ経由で
// 共有される。Node テストでは require できないため最小限だけ複製する）
global.MEDIA_MIME_RE = /^(video|audio)\//i;
global.MEDIA_URL_RE  = /\.(mp4|webm|mkv|mov|m4v|ogg|ogv|ts|m2ts|m3u8|mpd|m4s|m4a|mp3|aac|flac|opus|wav)(\?|#|$)/i;
const { addToStore, getStore, isHlsOrDashItem } = require("../../../background/mediaStore");

const TAB = 1;

test("addToStore/getStore/isHlsOrDashItem: HLS/DASH/収集ストリーム/直接ファイルの検出", () => {
// ── 直接ファイル（mp4 等）は再生時のような Range 分割DL対象として検出する ────
assert.strictEqual(
  addToStore(TAB, { url: "https://h/video.mp4", mimeHint: "video/mp4" }),
  true,
  "mp4 直リンクは追加される（downloadDirectRanged.js で分割DL）"
);
assert.strictEqual(getStore(TAB).size, 1, "mp4 がストアに入る");
// 拡張子もmimeHintも無関係なものは追加しない
assert.strictEqual(
  addToStore(TAB, { url: "https://h/page.html", mimeHint: "text/html" }),
  false,
  "html はメディアとして追加されない"
);

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
assert.strictEqual(getStore(TAB).size, 4, "mp4直リンク1件 + HLS/DASH系3件がストアに入る");

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

// ── isHlsOrDashItem（item.url/mimeHint から HLS/DASH かを判定するヘルパー） ──
assert.strictEqual(
  isHlsOrDashItem({ url: "https://h/v.m3u8", mimeHint: "" }),
  true,
  "m3u8 は HLS/DASH 判定で true"
);
assert.strictEqual(
  isHlsOrDashItem({ url: "https://h/v.mp4", mimeHint: "video/mp4" }),
  false,
  "mp4 直リンクは HLS/DASH ではない"
);
});
