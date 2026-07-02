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

  // ファイル名（URL の末尾部分）
  const filename = extractFilename(item.url);
  const filenameEl = document.createElement("div");
  filenameEl.className = "media-filename";
  filenameEl.textContent = filename;
  filenameEl.title = item.url;

  // ドメイン
  const domain = extractDomain(item.url);
  const domainEl = document.createElement("div");
  domainEl.className = "media-domain";
  domainEl.textContent = domain;

  // メタチップ行
  const meta = document.createElement("div");
  meta.className = "media-meta";

  // MIME
  if (item.mimeHint) meta.appendChild(makeChip(item.mimeHint));

  // 拡張子
  const ext = extractExt(item.url);
  if (ext) meta.appendChild(makeChip(ext.toUpperCase()));

  // ファイルサイズ
  if (item.contentLength != null) {
    const sizeChip = makeChip(formatSize(item.contentLength));
    sizeChip.classList.add("meta-chip--size");
    meta.appendChild(sizeChip);
  }

  // 検出元チップ（Network: 緑 / Blob: 橙 / DOM: 紫）
  const sourceLabel = item.source === "network" ? "Network"
    : item.source === "blob" ? "Blob"
    : "DOM";
  const sourceChipClass = item.source === "network" ? "meta-chip--network"
    : item.source === "blob"    ? "meta-chip--blob"
    : "meta-chip--dom";
  const sourceChip = makeChip(sourceLabel);
  sourceChip.classList.add(sourceChipClass);
  meta.appendChild(sourceChip);

  info.appendChild(filenameEl);
  info.appendChild(domainEl);
  info.appendChild(meta);

  // ── コピーボタン ──
  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "コピー";
  copyBtn.title = item.url;
  copyBtn.addEventListener("click", () => copyURL(item.url, copyBtn));

  li.appendChild(tagBadge);
  li.appendChild(info);
  li.appendChild(copyBtn);

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
      if (e.target.closest(".dl-btn, .copy-btn")) return;
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
      if (e.target.closest(".dl-btn, .copy-btn")) return;
      toggleDashAccordion(li, item);
    });
  }

  return li;
}

