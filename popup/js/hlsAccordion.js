// popup/js/hlsAccordion.js — MimicVault
// HLS バリアントアコーディオン toggleHlsAccordion

"use strict";

async function toggleHlsAccordion(li, item) {
  // すでに展開済みなら折りたたむ
  const existing = li.nextElementSibling;
  if (existing && existing.classList.contains("hls-variants")) {
    existing.remove();
    li.classList.remove("media-item--hls-open");
    return;
  }

  // ローディング表示
  li.classList.add("media-item--hls-open", "media-item--hls-loading");

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

  li.classList.remove("media-item--hls-loading");

  if (!result?.ok) {
    if (result?.error === "not_master") {
      // Media Playlist 単体 → そのまま DOWNLOAD_HLS_SEGMENTS に渡す
      const singleEl = document.createElement("div");
      singleEl.className = "hls-variants";

      const vli = document.createElement("li");
      vli.className = "hls-variant-item";

      const labelEl = document.createElement("span");
      labelEl.className = "variant-resolution";
      labelEl.textContent = "単一画質";

      const dlBtn = buildHlsVariantDownloadButton(item, item.url);

      vli.appendChild(labelEl);
      vli.appendChild(dlBtn);
      singleEl.appendChild(vli);
      li.insertAdjacentElement("afterend", singleEl);
    } else {
      // その他のエラー
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

