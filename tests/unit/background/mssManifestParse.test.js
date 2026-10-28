// tests/unit/background/mssManifestParse.test.js — MimicVault
// expandMssFragmentUrls の単体テスト（未テストの純粋ロジック関数）。
// parseIsmManifest は DOMParser(ブラウザAPI)に依存するため Node 単体テスト対象外
// （mssManifestParse.js 内のコメント参照）。
// 実行: npx vitest run tests/unit/background/mssManifestParse.test.js

"use strict";

const assert = require("assert");
const { expandMssFragmentUrls } = require("../../../background/mssManifestParse");

test("expandMssFragmentUrls: urlTemplateの{bitrate}/{start time}を各チャンクの値に展開する", () => {
  const segInfo = {
    bitrate: 500000,
    chunks: [0, 2000000, 4000000],
    urlTemplate: "https://h/v.ism/QualityLevels({bitrate})/Fragments(video={start time})",
  };
  assert.deepStrictEqual(
    expandMssFragmentUrls(segInfo),
    [
      "https://h/v.ism/QualityLevels(500000)/Fragments(video=0)",
      "https://h/v.ism/QualityLevels(500000)/Fragments(video=2000000)",
      "https://h/v.ism/QualityLevels(500000)/Fragments(video=4000000)",
    ]
  );
});

test("expandMssFragmentUrls: チャンクが無ければ空配列を返す", () => {
  assert.deepStrictEqual(
    expandMssFragmentUrls({ bitrate: 1, chunks: [], urlTemplate: "x{bitrate}x{start time}x" }),
    []
  );
});
