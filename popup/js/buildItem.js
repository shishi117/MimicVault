// popup/js/buildItem.js — MimicVault
// リストアイテム生成 buildItem

"use strict";

// ─── リストアイテム生成 ───────────────────────────────────────────────────────
function buildItem(item) {
  const li = document.createElement("li");
  li.className = "media-item";

  // ── サムネイル ──
  const thumbWrap = document.createElement("div");
  thumbWrap.className = "media-thumb";

  const img = document.createElement("img");
  img.className = "thumb-img";
  img.alt = "";
  img.dataset.url = item.url;

  if (item.thumbnail) {
    // background にキャッシュ済みのサムネイルがあればそのまま表示
    img.src = item.thumbnail;
    img.classList.add("thumb-img--loaded");
  }
  // キャッシュがない場合は後の requestThumbnails() でキューに積む

  thumbWrap.appendChild(img);
  li.appendChild(thumbWrap);

  // ── タグバッジ ──
  const tagBadge = document.createElement("span");
  tagBadge.className = "tag-badge";
  tagBadge.textContent = item.tag ?? "video";

  // ── 情報エリア ──
  const info = document.createElement("div");
  info.className = "media-info";

  // ドメイン（URL・ファイル名は非表示。ドメインが行の識別子）
  const domain = extractDomain(item.url);
  const domainEl = document.createElement("div");
  domainEl.className = "media-domain";
  domainEl.textContent = domain;

  // メタチップ行: 方式・長さ・サイズ
  const meta = document.createElement("div");
  meta.className = "media-meta";

  const metaInfo = mediaMetaStore.get(item.url);  // 先読み取得済みなら { method, durationSec, sizeBytes }

  // 方式（DASH/mux は先読み後に上書きされる）
  meta.appendChild(makeChip(metaInfo?.method ?? mediaMethodLabel(item)));

  // 動画の長さ（ストリームはメタ未取得なら "…"、直接ファイルは長さ不明なので出さない）
  const isStream = mediaMethodLabel(item) !== "直接";
  if (metaInfo?.durationSec) {
    meta.appendChild(makeChip(formatDuration(metaInfo.durationSec)));
  } else if (isStream) {
    meta.appendChild(makeChip("…"));
  }

  // ファイルサイズ（結合後の推定は "~" 付き、無ければ従来の contentLength）
  if (metaInfo?.sizeBytes != null) {
    const sizeChip = makeChip("~" + formatSize(metaInfo.sizeBytes));
    sizeChip.classList.add("meta-chip--size");
    meta.appendChild(sizeChip);
  } else if (item.contentLength != null) {
    const sizeChip = makeChip(formatSize(item.contentLength));
    sizeChip.classList.add("meta-chip--size");
    meta.appendChild(sizeChip);
  }

  info.appendChild(domainEl);
  info.appendChild(meta);

  li.appendChild(tagBadge);
  li.appendChild(info);

  // ── ダウンロードボタン ──
  const dlBtn = buildDownloadButton(item);
  li.appendChild(dlBtn);

  // m3u8 アイテムは行全体をクリックでバリアント展開
  const isHls = isHlsUrl(item.url) ||
    (item.mimeHint ?? "").includes("mpegurl") ||
    (item.mimeHint ?? "").includes("m3u8");

  if (isHls) {
    li.classList.add("media-item--hls");
    li.title = "クリックして画質一覧を表示";
    li.addEventListener("click", (e) => {
      // DL ボタン・コピーボタンのクリックは伝播させない
      if (e.target.closest(".dl-btn")) return;
      toggleHlsAccordion(li, item);
    });
  }

  // ── DASH アコーディオン（ステップ11） ──────────────────────────────────
  const isDash = isDashUrl(item.url) ||
    (item.mimeHint ?? "").includes("dash+xml") ||
    (item.mimeHint ?? "").includes("mpd");

  if (isDash) {
    li.classList.add("media-item--dash");
    li.title = "クリックしてトラック一覧を表示";
    li.addEventListener("click", (e) => {
      if (e.target.closest(".dl-btn")) return;
      toggleDashAccordion(li, item);
    });
  }

  return li;
}

