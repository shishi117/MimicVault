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
  //
  // 注意: HLS/DASH/収集ストリームの item.contentLength は、検出時に見えた
  // マニフェスト自体（.m3u8/.mpd、数百byte程度のテキスト）や断片1本分のサイズで、
  // 結合後の動画サイズとは無関係。GET_MEDIA_META が未取得/失敗のときにこれを
  // 「サイズ不明の代わり」として使うと、実際は巨大な動画が誤って「小さすぎる」
  // と一覧から消えてしまう。単体ファイル（ラベル「mp4分割」。item.contentLength が
  // 実ファイルそのもののサイズ）のときだけ Content-Length を使う。
  const minDur   = userSettings.popupMinDurationSec;
  const minSizeB = userSettings.popupMinSizeKB * 1024;
  items = items.filter(it => {
    const meta = mediaMetaStore.get(it.url);
    if (meta?.durationSec != null) return meta.durationSec >= minDur;
    const isSingleFile = !it.isSegmentGroup && mediaMethodLabel(it) === "mp4分割";
    const size = meta?.sizeBytes ?? (isSingleFile ? it.contentLength : null);
    return size == null || size >= minSizeB;
  });

  // ソート
  const sortKey = elSort?.value ?? "size";  items = [...items].sort((a, b) => {
    if (sortKey === "size") {
      // サイズ不明は末尾へ。buildItem の表示と同じ基準を使う:
      // ストリーム(HLS/DASH)は結合後推定サイズ(mediaMetaStore.sizeBytes)、
      // 単体ファイル（ラベル「分割」）は contentLength。ストリームの
      // contentLength はマニフェスト自体のサイズで実サイズと無関係なため
      // 流用しない（renderList 冒頭の注意コメント参照）。
      const sizeOf = (it) => {
        const meta = mediaMetaStore.get(it.url);
        if (meta?.sizeBytes != null) return meta.sizeBytes;
        const isSingleFile = !it.isSegmentGroup && mediaMethodLabel(it) === "分割";
        return isSingleFile ? (it.contentLength ?? -1) : -1;
      };
      return sizeOf(b) - sizeOf(a);
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
  } else {
    elCount.textContent = "0 件検出";
  }

  // リスト描画
  elList.innerHTML = "";
  for (const item of items) {
    elList.appendChild(buildItem(item));
  }
}

