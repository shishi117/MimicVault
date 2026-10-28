// vitest.config.js — MimicVault
// tests/unit 配下の Node 単体テストのみを対象にする。

"use strict";

module.exports = {
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    // vitest(ESM専用)を各テストから require() できないため、
    // test() をグローバル関数として注入する(既存の CommonJS テストとの互換用)。
    globals: true,
  },
};
