// background/downloaders.js — MimicVault
// 方式(hls/dash/segment) → 「全DL」時のハンドラ を1箇所にまとめた DOWNLOADERS マップ。
//
// 「DL方式ごとの処理を一元管理したい」という動機に対し、JSON+インタプリタ方式ではなく
// 素のJSオブジェクトで対応表を持つ（詳細は /root/.claude/plans/ 配下のレビュー記録参照）。
// 関数の実体は companionHls.js / autoDashMux.js / downloadSegmentGroup.js のまま変更しない。
// 呼び出し規約は (item, tabId) => Promise<result> に統一。

"use strict";

const DOWNLOADERS = {
  hls:     (item, tabId) => downloadHlsViaCompanion(item.url, item.pageURL || "", tabId),
  dash:    (item, tabId) => autoDashMux(item, tabId),
  segment: (item, tabId) => downloadSegmentGroup({ groupKey: item.groupKey, tabId }),
};

if (typeof module !== "undefined") module.exports = { DOWNLOADERS };
