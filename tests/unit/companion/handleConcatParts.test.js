// tests/unit/companion/handleConcatParts.test.js — MimicVault
// concatFiles の自己チェック。実行: npx vitest run tests/unit/companion/handleConcatParts.test.js
"use strict";

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const { concatFiles } = require("../../../companion/lib/handleConcatParts");

test("concatFiles: 渡した順番通りにファイルを欠落・重複なく連結する", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mv-concat-test-"));
  const partA = path.join(dir, "a.part");
  const partB = path.join(dir, "b.part");
  const partC = path.join(dir, "c.part");
  const out   = path.join(dir, "out.bin");

  fs.writeFileSync(partA, Buffer.from([1, 2, 3]));
  fs.writeFileSync(partB, Buffer.from([4, 5]));
  fs.writeFileSync(partC, Buffer.from([6, 7, 8, 9]));

  await concatFiles([partA, partB, partC], out);

  assert.deepStrictEqual(
    [...fs.readFileSync(out)],
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    "渡した順番通りにバイト列が欠落・重複なく連結される"
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
