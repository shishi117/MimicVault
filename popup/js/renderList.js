// popup/js/renderList.js — MimicVault
// フィルタ+ソート+リスト描画 renderList

"use strict";

// ─── フィルタ + ソート + レンダリング ─────────────────────────────────────────
function renderList() {
  // ── DL タブ: メディアリストではなく DL パネルを表示 ──────────────────────────
  if (activeFilter === "dl") {
    elEmpty.classList.add("hidden");
    elNoMatch.classList.add("hidden");
    elList.classList.add("hidden");
    elDlPanel.classList.remove("hidden");
    elToolbar.classList.remove("hidden");
    elToolbar.classList.add("toolbar--dl");
    elClearBtn.classList.add("hidden");

    const total = countDlEntries();
    elBadge.textContent = String(allItems.length);
    elBadge.classList.toggle("hidden", allItems.length === 0);
    elCount.textContent = `${total} 件のDL`;

    renderDlPanel();
    return;
  }

  // DL タブ以外では DL パネルを非表示・ツールバーのDLクラスを除去
  elDlPanel.classList.add("hidden");
  elToolbar.classList.remove("toolbar--dl");

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
    elBadge.textContent = String(allItems.length);
    elBadge.classList.remove("hidden");
    elCount.textContent = items.length === allItems.length
      ? `${allItems.length} 件検出`
      : `${items.length} / ${allItems.length} 件`;
    if (elDlAllBtn) elDlAllBtn.classList.remove("hidden");
  } else {
    elBadge.classList.add("hidden");
    elCount.textContent = "0 件検出";
    if (elDlAllBtn) elDlAllBtn.classList.add("hidden");
  }

  // リスト描画
  elList.innerHTML = "";
  for (const item of items) {
    elList.appendChild(buildItem(item));
  }
}

