// tests/unit/background/filename.test.js — MimicVault
// applyFilenameTemplate/sanitizeFilename の単体テスト（未テストの純粋ロジック関数）。
// 実行: npx vitest run tests/unit/background/filename.test.js

"use strict";

const assert = require("assert");

// filename.js が参照する settingsCache をスタブしてから読み込む
global.settingsCache = { filenameTemplate: "%title" };
const { applyFilenameTemplate, sanitizeFilename } = require("../../../background/filename");

test("sanitizeFilename: OS非対応文字を_に置換し、前後の空白/ドットを除去する", () => {
  assert.strictEqual(
    sanitizeFilename("a/b\\c:d*e?f\"g<h>i|j"),
    "a_b_c_d_e_f_g_h_i_j",
    "禁止文字(/ \\ : * ? \" < > |)を全て_に置換"
  );
  assert.strictEqual(sanitizeFilename("  .title.  "), "title", "前後の空白/ドットを除去");
  assert.strictEqual(sanitizeFilename(""), "media", "空文字は media にフォールバック");
});

test("applyFilenameTemplate: settingsCache.filenameTemplateに従い%titleを展開する", () => {
  global.settingsCache.filenameTemplate = "%title";
  assert.strictEqual(applyFilenameTemplate("video", "mp4"), "video.mp4", "%title を stem に展開し拡張子を付与");

  global.settingsCache.filenameTemplate = "REC_%title";
  assert.strictEqual(applyFilenameTemplate("video", "mp4"), "REC_video.mp4", "テンプレートの前置文字列を保持");

  global.settingsCache.filenameTemplate = "%title";
  assert.strictEqual(applyFilenameTemplate("a/b", "mp4"), "a_b.mp4", "stem 中の禁止文字もサニタイズされる");
  assert.strictEqual(applyFilenameTemplate(null, "mp4"), "media.mp4", "stem 省略時は media にフォールバック");
  assert.strictEqual(applyFilenameTemplate("video", ""), "video", "拡張子が空なら付与しない");
});
