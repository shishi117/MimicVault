// background/segmentGroups.test.js — MimicVault
// 断片検出・グループ化の自己チェック。実行: node background/segmentGroups.test.js

"use strict";

const assert = require("assert");

// segmentGroups.js が参照するグローバルをスタブしてから読み込む
global.tabMediaStore = {};
global.addToStore = (tabId, item) => {
  (global.tabMediaStore[tabId] ??= new Map()).set(item.url, item);
  return true;
};
const { isSegmentUrl, recordSegment, getSegmentGroupUrls } = require("./segmentGroups");

// ── isSegmentUrl ────────────────────────────────────────────────────────────
assert.ok(isSegmentUrl("https://h/v/720/5.m4s"),          ".m4s は断片");
assert.ok(isSegmentUrl("https://h/v/720/chunk.cmfv"),     ".cmfv は断片");
assert.ok(isSegmentUrl("https://h/v/720/init.mp4"),       "init.mp4 は断片");
assert.ok(isSegmentUrl("https://h/v/720/init-stream0.m4s?t=1"), "init-stream0.m4s は断片");
assert.ok(isSegmentUrl("https://h/v/seg-3-f4-v1-a1.ts?hash=x&expires=1"), ".ts もマニフェスト非露出の断片として対象");
assert.ok(!isSegmentUrl("https://h/v/movie.mp4"),         "progressive mp4 は非断片");
assert.ok(!isSegmentUrl("https://h/v/index.m3u8"),        "m3u8 は非断片");
assert.ok(!isSegmentUrl("https://h/v.ism/QualityLevels(400000)/Fragments(video=0)"), "Smooth Fragments は対象外");

// ── recordSegment / getSegmentGroupUrls ─────────────────────────────────────
const TAB = 42;
const dir = "https://h/video/720/";
recordSegment(TAB, dir + "init.mp4", "https://page/");
// 意図的に順不同で投入（末尾数値で昇順ソートされることを確認）
for (const n of [3, 1, 5, 2, 6, 4]) recordSegment(TAB, `${dir}seg-${n}.m4s`, "https://page/");

// 6 断片 ≥ SEG_MIN → 収集ストリーム item が1件表出している
const item = [...global.tabMediaStore[TAB].values()].find(it => it.isSegmentGroup);
assert.ok(item, "収集ストリーム item が生成される");
assert.strictEqual(item.groupKey, dir, "groupKey はディレクトリ");
assert.strictEqual(item.segmentCount, 6, "断片数は 6");

const g = getSegmentGroupUrls(TAB, dir);
assert.strictEqual(g.init, dir + "init.mp4", "init を保持");
assert.deepStrictEqual(
  g.media,
  [1, 2, 3, 4, 5, 6].map(n => `${dir}seg-${n}.m4s`),
  "メディア断片は末尾数値で昇順ソート"
);
assert.strictEqual(g.stem, "720", "stem はディレクトリ名");

// ── .ts 断片（init無し、末尾に画質/トラック識別子が付く命名） ─────────────────
// 例: eporner等。"seg-N-f4-v1-a1.ts" は末尾の数値("a1"の1)が全断片で共通のため、
// 末尾数値ではなく先頭の数値(N)でソートできることを確認する（順序バグの再発防止）。
const TAB3 = 44;
const tsDir = "https://h/video/ts/";
for (const n of [3, 1, 5, 2, 6, 4]) {
  recordSegment(TAB3, `${tsDir}seg-${n}-f4-v1-a1.ts?hash=x&expires=1`, "https://page/");
}
const tsItem = [...global.tabMediaStore[TAB3].values()].find(it => it.isSegmentGroup);
assert.ok(tsItem, ".ts も収集ストリーム item になる");

const tsGroup = getSegmentGroupUrls(TAB3, tsDir);
assert.strictEqual(tsGroup.init, null, ".ts には init が無い");
assert.deepStrictEqual(
  tsGroup.media,
  [1, 2, 3, 4, 5, 6].map(n => `${tsDir}seg-${n}-f4-v1-a1.ts?hash=x&expires=1`),
  "末尾の画質識別子に惑わされず先頭の数値で昇順ソートされる"
);

// マニフェスト(dash+xml)があるタブでは収集しない
const TAB2 = 43;
global.tabMediaStore[TAB2] = new Map([["m", { url: "m", mimeHint: "application/dash+xml" }]]);
for (let n = 0; n < 10; n++) recordSegment(TAB2, `https://h/dash/${n}.m4s`, "");
assert.ok(
  ![...global.tabMediaStore[TAB2].values()].some(it => it.isSegmentGroup),
  "マニフェスト検出済みタブでは収集ストリームを出さない"
);

console.log("segmentGroups.test.js: OK");
