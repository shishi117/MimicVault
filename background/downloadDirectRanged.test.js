// background/downloadDirectRanged.test.js — MimicVault
// buildChunkRanges の自己チェック。実行: node background/downloadDirectRanged.test.js

"use strict";

const assert = require("assert");
const { buildChunkRanges } = require("./downloadDirectRanged");

const MAX = 10 * 1024 * 1024; // RANGE_CHUNK_MAX_BYTES と同じ値

// ── 上限(10MB)未満のファイルは分割しない ────────────────────────────────────
assert.deepStrictEqual(buildChunkRanges(500_000), [[0, 499999]], "小さいファイルは1チャンク");
assert.deepStrictEqual(buildChunkRanges(MAX), [[0, MAX - 1]], "ちょうど上限サイズも1チャンク");

// ── 上限を超えるファイル: 各チャンクが上限の半分〜上限に収まり、欠落・重複なし ──
function assertNoGapsAndWithinRange(ranges, totalBytes) {
  assert.strictEqual(ranges[0][0], 0, "先頭は0から");
  assert.strictEqual(ranges[ranges.length - 1][1], totalBytes - 1, "末尾は全体サイズ-1まで");
  for (let i = 0; i < ranges.length; i++) {
    const size = ranges[i][1] - ranges[i][0] + 1;
    assert.ok(size <= MAX, `チャンク${i}が上限(10MB)を超えていない (${size})`);
    if (ranges.length > 1) {
      assert.ok(size > MAX / 2, `チャンク${i}が上限の半分(5MB)より大きい (${size})`);
    }
    if (i > 0) {
      assert.strictEqual(ranges[i][0], ranges[i - 1][1] + 1, `チャンク${i}は直前の続きから始まる（欠落/重複なし）`);
    }
  }
}

{
  const totalBytes = 55 * 1024 * 1024; // 55MB → ceil(55/10) = 6チャンク
  const ranges = buildChunkRanges(totalBytes);
  assert.strictEqual(ranges.length, 6, "55MBなら6チャンク");
  assertNoGapsAndWithinRange(ranges, totalBytes);
}

{
  // 1GB級の巨大ファイルでも、分割数が6固定ではなくサイズに応じて増える
  // （旧実装だと6分割固定で1チャンクが約170MBになってしまっていた）。
  const totalBytes = 1024 * 1024 * 1024; // 1GB
  const ranges = buildChunkRanges(totalBytes);
  assert.ok(ranges.length > 6, `1GBなら6チャンクより多く分割される (${ranges.length})`);
  assertNoGapsAndWithinRange(ranges, totalBytes);
}

console.log("downloadDirectRanged.test.js: OK");
