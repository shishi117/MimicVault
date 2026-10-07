// popup/js/renderList.js — MimicVault
// フィルタ+ソート+リスト描画 renderList

"use strict";

// ─── フィルタ + ソート + レンダリング ─────────────────────────────────────────
function renderList() {
  // フィルタ
  let items = allItems.filter(item => {
    if (activeFilter === "all")   return true;
    if (activeFilter === "video") return item.tag !== "audio";
    if (activeFilter === "audio") return item.tag === "audio";
    return true;
  });

  // m3u8 があるとき、単独の .ts（セグメント）は冗長なので一覧から隠す。
  // 個別DLせず、m3u8 のDL（＝変換）でまとめて取得されるため。
  if (allItems.some(it => isHlsUrl(it.url) || (it.mimeHint || "").includes("mpegurl"))) {
    items = items.filter(it => !isTsSegment(it));
  }

  // 3.5: 短尺・極小の断片を隠す。長さが分かれば再生時間で、長さ不明なら
  // サイズ（結合後推定 or Content-Length）で判定する。基準値は設定で変更可（0 で無効）。
  // サイズも不明なら判定不能なので表示する。
  const minDur   = userSettings.popupMinDurationSec;
  const minSizeB = userSettings.popupMinSizeKB * 1024;
  items = items.filter(it => {
    const meta = mediaMetaStore.get(it.url);
    if (meta?.durationSec != null) return meta.durationSec >= minDur;
    const size = meta?.sizeBytes ?? it.contentLength;
    return size == null || size >= minSizeB;
  });

  // ソート
  const sortKey = elSort?.value ?? "time";  items = [...items].sort((a, b) => {
    if (sortKey === "size") {
      // サイズ不明（null）は末尾へ
      const sa = a.contentLength ?? -1;
      const sb = b.contentLength ?? -1;
      return sb - sa;
    }
    if (sortKey === "domain") {
      return extractDomain(a.url).localeCompare(extractDomain(b.url));
    }
    // "time" — 新しい順（detectedAt 降順）
    return (b.detectedAt ?? 0) - (a.detectedAt ?? 0);
  });

  // 表示状態の制御
  const hasAny     = allItems.length > 0;
  const hasMatched = items.length > 0;

  elEmpty.classList.toggle("hidden", hasAny);
  elNoMatch.classList.toggle("hidden", !hasAny || hasMatched);
  elList.classList.toggle("hidden", !hasMatched);
  elToolbar.classList.toggle("hidden", !hasAny);
  elClearBtn.classList.toggle("hidden", !hasAny);

  if (hasAny) {
    elCount.textContent = items.length === allItems.length
      ? `${allItems.length} 件検出`
      : `${items.length} / ${allItems.length} 件`;
    if (elDlAllBtn) elDlAllBtn.classList.remove("hidden");
  } else {
    elCount.textContent = "0 件検出";
    if (elDlAllBtn) elDlAllBtn.classList.add("hidden");
  }

  // リスト描画
  elList.innerHTML = "";
  for (const item of items) {
    elList.appendChild(buildItem(item));
  }
}

