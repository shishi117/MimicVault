// background/downloadDirectRanged.test.js — MimicVault
// buildChunkRanges の自己チェック。実行: node background/downloadDirectRanged.test.js

"use strict";

const assert = require("assert");
const { buildChunkRanges } = require("./downloadDirectRanged");

// ── 小さいファイル(1MB未満)は分割しない ──────────────────────────────────────
assert.deepStrictEqual(buildChunkRanges(500_000), [[0, 499999]], "1MB未満は1チャンク");

// ── ちょうど分割できるサイズ: 6チャンクに等分、末尾まで欠落・重複なく連続する ──
{
  const ranges = buildChunkRanges(12_000_000); // 1MBチャンク上限なら十分分割される
  assert.strictEqual(ranges.length, 6, "十分な大きさなら上限6チャンクに分割");
  assert.strictEqual(ranges[0][0], 0, "先頭は0から");
  assert.strictEqual(ranges[ranges.length - 1][1], 12_000_000 - 1, "末尾は全体サイズ-1まで");
  for (let i = 1; i < ranges.length; i++) {
    assert.strictEqual(ranges[i][0], ranges[i - 1][1] + 1, `チャンク${i}は直前の続きから始まる（欠落/重複なし）`);
  }
}

// ── 中間サイズ(1MB以上だが6チャンク分には満たない)は MB 単位の個数に分割 ──────
{
  const ranges = buildChunkRanges(3_500_000);
  assert.strictEqual(ranges.length, 3, "3.5MBなら3チャンク（1MB未満のfloorで3）");
}

console.log("downloadDirectRanged.test.js: OK");
