// popup/js/hlsAccordion.js — MimicVault
// HLS バリアント一覧表示 renderHlsVariants

"use strict";

/**
 * HLS アイテムの画質一覧を取得して常時表示する（クリックでの開閉はしない）。
 * buildItem.js から各 HLS アイテムの行を作った直後に呼ばれる。
 *
 * @param {HTMLElement} li     - アイテムの行
 * @param {object}      item   - アイテム
 * @param {HTMLElement}  dlBtn - li 自身が持つ DL ボタン（buildDownloadButton が作成）。
 *   Media Playlist 単体（not_master）ならこのボタンがそのまま正しい DL 手段なので
 *   そのまま残すが、Master Playlist で複数画質が見つかった場合はこのボタンを押しても
 *   「画質を選択してください」エラーにしかならないため取り除く。
 */
async function renderHlsVariants(li, item, dlBtn) {
  // 二重呼び出し対策（通常は発生しないが念のため）
  const existing = li.nextElementSibling;
  if (existing && existing.classList.contains("hls-variants")) return;

  // ローディング表示（取得できたら置き換える）
  const loadingEl = document.createElement("div");
  loadingEl.className = "hls-variants hls-variants--loading";
  loadingEl.textContent = "画質を取得中…";
  li.insertAdjacentElement("afterend", loadingEl);

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:    "FETCH_HLS_VARIANTS",
      url:     item.url,
      pageURL: item.pageURL ?? "",
    });
  } catch (_) {
    result = { ok: false, error: "send_failed" };
  }

  loadingEl.remove();

  if (!result?.ok) {
    // not_master（Media Playlist 単体）は li 自身の DL ボタンがそのまま正しい
    // DL 手段なので、重複する行は追加しない。それ以外のエラーのみ表示する。
    if (result?.error !== "not_master") {
      const errEl = document.createElement("div");
      errEl.className = "hls-variants hls-variants--error";
      errEl.textContent = `取得失敗: ${result?.error ?? "不明なエラー"}`;
      li.insertAdjacentElement("afterend", errEl);
    }
    return;
  }

  if (result.variants.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "hls-variants hls-variants--error";
    emptyEl.textContent = "バリアントが見つかりませんでした";
    li.insertAdjacentElement("afterend", emptyEl);
    return;
  }

  // Master Playlist と判明 → li 自身の DL ボタンは「画質を選択してください」
  // エラーにしかならないので取り除く（DL は下の各画質行のボタンで行う）。
  dlBtn?.remove();

  // バリアント一覧を構築
  const variantList = document.createElement("ul");
  variantList.className = "hls-variants";

  // ステップ18: 設定の優先画質に一致するインデックスを事前に計算
  const preferredIdx = pickPreferredVariantIndex(result.variants);

  for (let vi = 0; vi < result.variants.length; vi++) {
    const v = result.variants[vi];
    const vli = document.createElement("li");
    vli.className = "hls-variant-item";
    if (vi === preferredIdx) {
      vli.classList.add("hls-variant-item--preferred");
      vli.title = "設定の優先画質";
    }

    // 解像度
    const resEl = document.createElement("span");
    resEl.className = "variant-resolution";
    resEl.textContent = v.resolution ?? "不明";

    // 帯域幅
    const bwEl = document.createElement("span");
    bwEl.className = "variant-bandwidth";
    bwEl.textContent = formatBandwidth(v.bandwidth);

    // DL ボタン（バリアントの Media Playlist URL で HLS セグメントダウンロード）
    const dlBtn = buildHlsVariantDownloadButton(item, v.url);

    vli.appendChild(resEl);
    vli.appendChild(bwEl);
    vli.appendChild(dlBtn);
    variantList.appendChild(vli);
  }

  li.insertAdjacentElement("afterend", variantList);
}

