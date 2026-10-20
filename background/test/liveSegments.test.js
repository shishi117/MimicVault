// background/test/liveSegments.test.js — MimicVault
// liveChunkFilename/liveSessionFilename の自己チェック:
// パネルに表示するファイル名が flushChunk の実際の保存ファイル名と一致することを確認する。
// 実行: node background/test/liveSegments.test.js

"use strict";

const assert = require("assert");

// liveSegments.js が参照する applyFilenameTemplate 等をスタブしてから読み込む
global.settingsCache = { filenameTemplate: "%title" };
global.applyFilenameTemplate = require("../filename").applyFilenameTemplate;

const { liveChunkFilename, liveSessionFilename } = require("../liveSegments");

// ── flushChunk が downloads.download に渡す実際のファイル名と同じ形式 ──────────
assert.strictEqual(
  liveChunkFilename("stream", 1),
  "stream_chunk001.ts",
  "チャンク1件目は _chunk001 サフィックス + .ts 拡張子"
);

// ── 録画中は「次に保存される」（まだ存在しない）チャンクを先読み表示する ────────
assert.strictEqual(
  liveSessionFilename({ state: "recording", stem: "stream", chunkIndex: 0 }),
  liveChunkFilename("stream", 1),
  "録画中・未フラッシュ時は次チャンク(1件目)のファイル名を表示"
);
assert.strictEqual(
  liveSessionFilename({ state: "recording", stem: "stream", chunkIndex: 2 }),
  liveChunkFilename("stream", 3),
  "録画中・2件フラッシュ済みなら次の3件目を表示"
);

// ── 停止/終了後は直前に実際にフラッシュされたチャンクと一致（次の未生成チャンクではない） ──
assert.strictEqual(
  liveSessionFilename({ state: "stopped", stem: "stream", chunkIndex: 3 }),
  liveChunkFilename("stream", 3),
  "停止後は最後にフラッシュ済みのチャンクを表示"
);
assert.strictEqual(
  liveSessionFilename({ state: "ended", stem: "stream", chunkIndex: 5 }),
  liveChunkFilename("stream", 5),
  "ended も同様"
);

// ── filenameTemplate のカスタム設定も、applyFilenameTemplate を共有利用しているため
//    自動で反映される ───────────────────────────────────────────────────────
global.settingsCache.filenameTemplate = "REC_%title";
assert.strictEqual(
  liveChunkFilename("stream", 1),
  "REC_stream_chunk001.ts",
  "filenameTemplate のカスタム設定も反映される"
);

console.log("liveSegments.test.js: OK");
