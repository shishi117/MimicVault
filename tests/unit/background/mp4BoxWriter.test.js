// tests/unit/background/mp4BoxWriter.test.js — MimicVault
// box/fullBox/concatBytes/fourcc/u8/u16be/u32be の単体テスト（未テストの純粋ロジック関数）。
// 実行: npx vitest run tests/unit/background/mp4BoxWriter.test.js

"use strict";

const assert = require("assert");
const { u8, u16be, u32be, concatBytes, fourcc, box, fullBox } = require("../../../background/mp4BoxWriter");

test("u8/u16be/u32be: 整数をbig-endianバイト列に変換する(下位バイトのみ保持)", () => {
  assert.deepStrictEqual([...u8(0x12)], [0x12]);
  assert.deepStrictEqual([...u8(0x1FF)], [0xFF], "8bitを超える分は切り捨てる");
  assert.deepStrictEqual([...u16be(0x1234)], [0x12, 0x34]);
  assert.deepStrictEqual([...u32be(0x12345678)], [0x12, 0x34, 0x56, 0x78]);
});

test("concatBytes: Uint8Arrayの配列を欠落・重複なく1本に連結する", () => {
  const out = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]);
  assert.deepStrictEqual([...out], [1, 2, 3, 4, 5]);
  assert.deepStrictEqual([...concatBytes([])], [], "空配列なら空のバイト列");
});

test("fourcc: 4文字のボックスタイプ文字列をASCIIバイト列に変換する", () => {
  assert.deepStrictEqual([...fourcc("ftyp")], [102, 116, 121, 112]);
  assert.throws(() => fourcc("abc"), /fourcc must be 4 chars/, "4文字でなければエラー");
});

test("box: size(4byte)+type(4byte)+payload で ISO BMFF ボックスを構築する", () => {
  assert.deepStrictEqual(
    [...box("free")],
    [0, 0, 0, 8, 102, 114, 101, 101],
    "payload無しなら size=8(ヘッダのみ)"
  );
  assert.deepStrictEqual(
    [...box("free", new Uint8Array([1, 2]))],
    [0, 0, 0, 10, 102, 114, 101, 101, 1, 2],
    "payloadを含めたsizeになる"
  );
});

test("fullBox: version(1byte)+flags(3byte)を先頭に付けたFullBoxを構築する", () => {
  assert.deepStrictEqual(
    [...fullBox("test", 0, 0)],
    [0, 0, 0, 12, 116, 101, 115, 116, 0, 0, 0, 0],
    "version=0, flags=0"
  );
  assert.deepStrictEqual(
    [...fullBox("test", 1, 1, new Uint8Array([9]))],
    [0, 0, 0, 13, 116, 101, 115, 116, 1, 0, 0, 1, 9],
    "version/flagsと追加payloadを連結する"
  );
});
