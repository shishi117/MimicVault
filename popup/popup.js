/**
 * popup.js  (v0.18.0 — v0.18.0)
 *
 * ステップ18で追加:
 *   - 設定ボタン（歯車アイコン）→ browser.runtime.openOptionsPage()
 *   - HLS バリアントリストで優先画質をハイライト表示
 *     （設定の hlsPreferred に一致するバリアントに border/bg 強調）
 *   - companion インジケータの "disabled" ステータスを認識
 *
 * 継承（ステップ15/16）:
 *   - companion インジケータ: 接続状態をヘッダー右端に表示
 *   - HLS ダウンロード進捗に FFmpeg 変換フェーズを追加
 *   - クリックで companion 再接続を試みる
 */

"use strict";

// ─── DOM 参照 ─────────────────────────────────────────────────────────────────
const elEmpty    = document.getElementById("state-empty");
const elNoMatch  = document.getElementById("state-no-match");
const elList     = document.getElementById("media-list");
const elBadge    = document.getElementById("badge");
const elCount    = document.getElementById("count-label");
const elToolbar  = document.getElementById("toolbar");
const elClearBtn = document.getElementById("clear-btn");
const elSort     = document.getElementById("sort-select");
const elLiveBanner = document.getElementById("live-banner");
const elDlPanel  = document.getElementById("dl-panel");
const filterTabs = document.querySelectorAll(".filter-tab");
const elCompanionIndicator = document.getElementById("companion-indicator");
const elSettingsBtn        = document.getElementById("settings-btn");
const elDlAllBtn           = document.getElementById("dl-all-btn");

// ─── 状態 ─────────────────────────────────────────────────────────────────────
let allItems     = [];     // background から取得した全アイテム
let activeFilter = "all";  // "all" | "video" | "audio"
let currentTabId = null;   // サムネイルリクエストで使うタブ ID

// ステップ18: 設定キャッシュ（hlsPreferred を HLS アコーディオン表示に反映するのに使用）
let userSettings = { hlsPreferred: "highest", filenameTemplate: "%title" };

async function loadUserSettings() {
  try {
    const stored = await browser.storage.local.get("ms_settings");
    userSettings = { hlsPreferred: "highest", filenameTemplate: "%title", ...(stored.ms_settings ?? {}) };
  } catch (_) { /* デフォルトのまま */ }
}

/**
 * バリアント一覧から設定の優先画質に一致するインデックスを返す。
 * 見つからなければ 0（最高画質）を返す。
 * バリアントは background 側で bandwidth 降順ソート済み。
 *
 * @param {Array<{resolution: string|null, bandwidth: number}>} variants
 */
function pickPreferredVariantIndex(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return -1;

  const pref = userSettings.hlsPreferred;
  if (!pref || pref === "highest") return 0;

  // "1080p" → 1080 を抽出して、resolution の height と一致するものを探す
  const targetHeight = parseInt(String(pref).replace(/\D/g, ""), 10);
  if (!Number.isFinite(targetHeight)) return 0;

  // 完全一致優先
  for (let i = 0; i < variants.length; i++) {
    const h = parseHeight(variants[i].resolution);
    if (h === targetHeight) return i;
  }
  // フォールバック: 最高画質
  return 0;
}

function parseHeight(resolution) {
  if (!resolution) return null;
  const m = String(resolution).match(/(\d+)x(\d+)/);
  return m ? parseInt(m[2], 10) : null;
}

// ─── Companion 状態管理（ステップ15/16） ─────────────────────────────────────

/**
 * companion の接続状態を UI に反映する。
 *
 * @param {"connected"|"disconnected"|"error"} status
 */
function updateCompanionIndicator(status) {
  if (!elCompanionIndicator) return;

  // クラスをすべてリセット
  elCompanionIndicator.classList.remove(
    "companion-connected",
    "companion-disconnected",
    "companion-error"
  );

  switch (status) {
    case "connected":
      elCompanionIndicator.classList.add("companion-connected");
      elCompanionIndicator.title = "Companion 接続済み — FFmpeg 変換が有効です";
      break;
    case "error":
      elCompanionIndicator.classList.add("companion-error");
      elCompanionIndicator.title = "Companion エラー — クリックして再接続";
      break;
    case "disabled":
      // ステップ18: 設定で無効化されている場合
      elCompanionIndicator.classList.add("companion-disconnected");
      elCompanionIndicator.title = "Companion は設定で無効化されています（クリックで再接続試行）";
      break;
    default: // "disconnected"
      elCompanionIndicator.classList.add("companion-disconnected");
      elCompanionIndicator.title = "Companion 未接続 — クリックして再接続";
  }
}

// 起動時に background から現在の companion 状態を取得
browser.runtime.sendMessage({ type: "GET_COMPANION_STATUS" })
  .then(res => updateCompanionIndicator(res?.status ?? "disconnected"))
  .catch(() => updateCompanionIndicator("disconnected"));

// インジケータをクリックしたら再接続を試みる
if (elCompanionIndicator) {
  elCompanionIndicator.addEventListener("click", () => {
    elCompanionIndicator.title = "接続中...";
    browser.runtime.sendMessage({ type: "CONNECT_COMPANION" })
      .then(res => updateCompanionIndicator(res?.status ?? "disconnected"))
      .catch(() => updateCompanionIndicator("error"));
  });
}

// ─── ダウンロード状態管理 ──────────────────────────────────────────────────────
/**
 * key: item.url
 * value: {
 *   downloadId: number,
 *   state: "downloading" | "complete" | "error" | "interrupted",
 *   progress: number,   // 0〜100（bytesReceived / totalBytes）
 * }
 */
const downloadStates = new Map();

/**
 * HLS セグメントダウンロードの状態管理。
 * key: Media Playlist URL
 * value: {
 *   state:   "fetching" | "complete" | "error",
 *   current: number,   // 取得済みセグメント数
 *   total:   number,   // 総セグメント数
 *   error?:  string,
 * }
 */
const hlsDownloadStates = new Map();

/**
 * ダウンロード状態を downloadStates に反映する。
 * ダウンロードIDから URL を逆引きするため downloadIdToUrl も管理する。
 */
const downloadIdToUrl = new Map();  // downloadId → url

/**
 * DASH トラックダウンロードの状態管理（ステップ12）。
 * key: `${mpdUrl}::${repId}`
 * value: { state: "fetching"|"complete"|"error", current, total, error? }
 */
const dashDownloadStates = new Map();

/**
 * DASH mux の状態管理（v0.18.0）。
 * key: mpdUrl, value: { state: "fetching"|"complete"|"error", phase, current, total, error? }
 */
const dashMuxStates = new Map();

/**
 * DASH mux 開始時のメタ情報。
 * key: mpdUrl, value: { item, videoRep, audioRep, detectedAt }
 */
const dashMuxMeta = new Map();

/**
 * MPD URL ごとの総再生時間（秒）。
 * FETCH_DASH_INFO レスポンスを受け取ったときに格納し、
 * DOWNLOAD_DASH_TRACK 送信時に参照する。
 * key: mpdUrl, value: number（秒）
 */
const mpdDurationStore = new Map();

// ─── DL パネル用メタ情報（ステップ14） ────────────────────────────────────────
/**
 * 直接ダウンロード開始時のメタ情報。DL パネルでの表示・リトライに使用。
 * key: url, value: { item, detectedAt }
 */
const downloadMeta = new Map();

/**
 * HLS セグメントダウンロード開始時のメタ情報。
 * key: variantUrl, value: { item, detectedAt }
 */
const hlsDownloadMeta = new Map();

/**
 * DASH トラックダウンロード開始時のメタ情報。
 * key: `${mpdUrl}::${repId}`, value: { item, rep, trackType, detectedAt }
 */
const dashDownloadMeta = new Map();

/**
 * ライブ録画セッションの状態管理（ステップ10）。
 * key: Media Playlist URL
 * value: {
 *   state:         "recording" | "stopped" | "ended",
 *   totalSegments: number,
 *   chunkIndex:    number,
 *   stem:          string,
 * }
 */
const liveRecordingStates = new Map();

browser.downloads.onChanged.addListener((delta) => {
  const url = downloadIdToUrl.get(delta.id);
  if (!url) return;

  const ds = downloadStates.get(url);
  if (!ds) return;

  // 進捗更新
  if (delta.bytesReceived && delta.totalBytes) {
    const received = delta.bytesReceived.current ?? 0;
    const total    = delta.totalBytes.current ?? 0;
    if (total > 0) ds.progress = Math.round((received / total) * 100);
  }

  // 状態遷移
  if (delta.state) {
    const next = delta.state.current;
    if (next === "complete")     ds.state = "complete";
    if (next === "interrupted")  ds.state = "interrupted";
  }
  if (delta.error) {
    ds.state = "error";
  }

  // ボタン UI を更新する
  updateDownloadButton(url);
  // DL タブが開いていれば DL パネルも更新
  if (activeFilter === "dl") renderDlPanel();
});

/**
 * background から届く HLS セグメント取得の進捗を受け取り、
 * バリアント DL ボタンの表示を更新する。
 */
browser.runtime.onMessage.addListener((message) => {
  // ── ステップ12: DASH セグメント取得の進捗 ────────────────────────────────
  if (message.type === "DASH_DOWNLOAD_PROGRESS") {
    const { mpdUrl, repId, current, total } = message;
    const key = `${mpdUrl}::${repId}`;
    const dds = dashDownloadStates.get(key);
    if (dds) {
      dds.current = current;
      dds.total   = total;
      updateDashDownloadButton(key);
      if (activeFilter === "dl") renderDlPanel();
    }
    return;
  }

  if (message.type === "HLS_DOWNLOAD_PROGRESS") {
    const { url, current, total, converting } = message;
    const hds = hlsDownloadStates.get(url);
    if (!hds) return;
    hds.current    = current;
    hds.total      = total;
    hds.converting = converting ?? false; // true = FFmpeg 変換フェーズ（ステップ16）
    updateHlsDownloadButton(url);
    if (activeFilter === "dl") renderDlPanel();
    return;
  }

  // ── v0.18.0: DASH mux 進捗 ────────────────────────────────────────────────
  if (message.type === "DASH_MUX_PROGRESS") {
    const { mpdUrl, phase, current, total } = message;
    const muxKey = `${mpdUrl}::mux`;
    let mds = dashMuxStates.get(mpdUrl);
    if (mds) {
      mds.phase   = phase;
      mds.current = current;
      mds.total   = total;
      updateDashMuxButton(mpdUrl);
      if (activeFilter === "dl") renderDlPanel();
    }
    return;
  }

  // ── v0.18.0: DASH mux フォールバック通知 ─────────────────────────────────
  if (message.type === "DASH_MUX_FALLBACK") {
    showToast("companion 未接続のため映像・音声を別ファイルで保存します");
    return;
  }

  // ── ステップ15: companion 接続状態変化の通知 ───────────────────────────────
  if (message.type === "COMPANION_STATUS") {
    updateCompanionIndicator(message.status ?? "disconnected");
    return;
  }

  // ── ステップ10: ライブ録画進捗 ────────────────────────────────────────────
  if (message.type === "LIVE_RECORDING_PROGRESS") {
    const { url, state, totalSegments, chunkIndex, stem } = message;

    let lrs = liveRecordingStates.get(url);
    if (!lrs) {
      lrs = { state: "recording", totalSegments: 0, chunkIndex: 0, stem: stem ?? "" };
      liveRecordingStates.set(url, lrs);
    }
    lrs.state         = state;
    lrs.totalSegments = totalSegments;
    lrs.chunkIndex    = chunkIndex;
    if (stem) lrs.stem = stem;

    // バナーを更新（状態変化時は全体再構築、統計更新のみなら軽量パス）
    if (state === "recording" && liveRecordingStates.has(url)) {
      updateLiveBannerStats(url);  // 数値だけ書き換え（軽量）
    } else {
      buildLiveRecordingBanner();  // 開始・終了・停止時は再構築
    }

    // バリアントボタンがあれば更新
    updateLiveRecordingButton(url);
  }
});

// ─── メイン ───────────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  // ステップ18: 設定を先に読み込む（HLS アコーディオン表示時に使う）
  await loadUserSettings();

  try {
    const res = await browser.runtime.sendMessage({
      type: "GET_MEDIA_LIST",
      tabId: tab.id,
    });
    allItems = res?.items ?? [];
  } catch (_) {
    allItems = [];
  }

  // ── ステップ10: 進行中のライブセッションを復元してバナーに表示 ──────────────
  try {
    const liveRes = await browser.runtime.sendMessage({ type: "GET_LIVE_SESSIONS" });
    for (const s of liveRes?.sessions ?? []) {
      liveRecordingStates.set(s.url, {
        state:         s.state,
        totalSegments: s.totalSegments,
        chunkIndex:    s.chunkIndex,
        stem:          s.stem,
      });
    }
  } catch (_) {}
  buildLiveRecordingBanner();

  // イベント登録
  filterTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      filterTabs.forEach(b => b.classList.toggle("active", b === btn));
      renderList();
    });
  });

  elSort.addEventListener("change", renderList);

  elClearBtn.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "CLEAR_MEDIA_LIST", tabId: currentTabId });
    allItems = [];
    renderList();
  });

  // ステップ18: 設定ボタン → options ページを開く
  if (elSettingsBtn) {
    elSettingsBtn.addEventListener("click", () => {
      browser.runtime.openOptionsPage().catch(err => {
        console.error("[popup] openOptionsPage failed:", err);
      });
      // ポップアップは options ページを開いた後すぐ閉じて UX をスムーズに
      window.close();
    });
  }

  // v0.18.0: 全件DLボタン
  if (elDlAllBtn) {
    elDlAllBtn.addEventListener("click", () => startDownloadAll());
  }

  renderList();
  requestThumbnails(currentTabId);
}

/**
 * 検出された全アイテムを DOWNLOAD_MEDIA_ALL で background に一括送信する。
 * HLS / DASH アイテムは直接 DL（URL そのもの）になるため、
 * ストリーム系の結合は別途必要になることをトーストで通知する。
 */
async function startDownloadAll() {
  if (allItems.length === 0) return;

  elDlAllBtn.disabled = true;
  elDlAllBtn.textContent = "…";

  try {
    const res = await browser.runtime.sendMessage({
      type:  "DOWNLOAD_MEDIA_ALL",
      tabId: currentTabId,
    });
    const dl         = res?.results ?? [];
    const failed     = dl.filter(r => !r.ok).length;
    const ok         = dl.length - failed;
    const converting = res?.converting ?? 0;
    const skipped    = res?.skipped ?? [];

    const parts = [];
    if (ok > 0)         parts.push(`${ok}件DL開始`);
    if (converting > 0) parts.push(`${converting}件を変換開始`);
    if (failed > 0)     parts.push(`${failed}件失敗`);
    if (skipped.length) {
      const reasons = [...new Set(skipped.map(s => s.reason))];
      parts.push(`${skipped.length}件スキップ(${reasons.join("・")})`);
    }
    showToast(parts.length ? parts.join(" / ") : "対象がありません");
  } catch (err) {
    showToast("全件DL失敗: " + err.message);
  }

  elDlAllBtn.disabled = false;
  elDlAllBtn.textContent = "▶ 全DL";
  if (activeFilter === "dl") renderDlPanel();
}

// ─── サムネイルリクエスト ─────────────────────────────────────────────────────

/**
 * リスト内の未取得アイテムを順番にキューへ積む。
 * background キャッシュ済み（img--loaded クラス付き）はスキップ。
 */
function requestThumbnails(tabId) {
  const imgs = elList.querySelectorAll(".thumb-img:not(.thumb-img--loaded):not(.thumb-img--failed)");
  for (const img of imgs) {
    enqueueThumb(img.dataset.url, tabId, img);
  }
}

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

// ─── HLS アコーディオン ───────────────────────────────────────────────────────

/** URL が m3u8 かどうかを判定 */
function isHlsUrl(url) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

/** アイテムが HLS セグメント（.ts）かどうか */
function isTsSegment(item) {
  return /\.ts(\?|#|$)/i.test(item.url) || (item.mimeHint || "").includes("mp2t");
}

/** URL が MPEG-DASH MPD かどうかを判定 */
function isDashUrl(url) {
  return /\.mpd(\?|#|$)/i.test(url);
}

// ─── DASH アコーディオン（ステップ11） ────────────────────────────────────────

/**
 * DASH アイテムのアコーディオン展開・折りたたみをトグルする。
 * 展開済みなら折りたたむ、未展開なら FETCH_DASH_INFO を送信して展開する。
 */
async function toggleDashAccordion(li, item) {
  // すでに展開済みなら折りたたむ
  const existing = li.nextElementSibling;
  if (existing && existing.classList.contains("dash-panel")) {
    existing.remove();
    li.classList.remove("media-item--dash-open");
    return;
  }

  li.classList.add("media-item--dash-open", "media-item--dash-loading");

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:    "FETCH_DASH_INFO",
      url:     item.url,
      pageURL: item.pageURL ?? "",
    });
  } catch (_) {
    result = { ok: false, error: "send_failed" };
  }

  li.classList.remove("media-item--dash-loading");

  // 総再生時間を保存（DOWNLOAD_DASH_TRACK 送信時に参照）
  if (result?.ok && result.mpdDuration !== undefined) {
    mpdDurationStore.set(item.url, result.mpdDuration);
  }

  if (!result?.ok) {
    const errEl = document.createElement("div");
    errEl.className = "dash-panel dash-panel--error";
    errEl.textContent = dashErrorMessage(result?.error);
    li.insertAdjacentElement("afterend", errEl);
    return;
  }

  // ── パネルを構築 ──────────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.className = "dash-panel";

  // 映像トラック
  if (result.videoReps.length > 0) {
    const hdr = document.createElement("div");
    hdr.className = "dash-section-header";
    hdr.textContent = `映像トラック (${result.videoReps.length}件)`;
    panel.appendChild(hdr);

    const ul = document.createElement("ul");
    ul.className = "dash-track-list";
    for (const rep of result.videoReps) {
      ul.appendChild(buildDashTrackItem(item, rep, "video"));
    }
    panel.appendChild(ul);
  }

  // 音声トラック
  if (result.audioReps.length > 0) {
    const hdr = document.createElement("div");
    hdr.className = "dash-section-header";
    hdr.textContent = `音声トラック (${result.audioReps.length}件)`;
    panel.appendChild(hdr);

    const ul = document.createElement("ul");
    ul.className = "dash-track-list";
    for (const rep of result.audioReps) {
      ul.appendChild(buildDashTrackItem(item, rep, "audio"));
    }
    panel.appendChild(ul);
  }

  // mux ボタン（映像・音声両方が存在する場合）
  if (result.videoReps.length > 0 && result.audioReps.length > 0) {
    const muxArea = document.createElement("div");
    muxArea.className = "dash-mux-area";

    const muxLabel = document.createElement("span");
    muxLabel.className = "dash-mux-label";
    muxLabel.textContent = "映像+音声を結合して保存:";

    const muxBtn = document.createElement("button");
    muxBtn.className = "dl-btn dash-mux-btn";
    muxBtn.dataset.mpdUrl = item.url;
    const existingMux = dashMuxStates.get(item.url);
    applyDashMuxButtonState(muxBtn, existingMux);

    muxBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startDashMux(item, result.videoReps[0], result.audioReps[0], muxBtn);
    });

    muxArea.appendChild(muxLabel);
    muxArea.appendChild(muxBtn);
    panel.appendChild(muxArea);
  } else {
    // mux 注記（片方しかない場合）
    const note = document.createElement("div");
    note.className = "dash-mux-note";
    note.textContent = "⚠ 映像・音声は別ファイルで保存されます";
    panel.appendChild(note);
  }

  li.insertAdjacentElement("afterend", panel);
}

/**
 * DASH トラック1行を生成する。
 *
 * 映像トラック: 解像度 | ビットレート | コーデック | DL ボタン
 * 音声トラック: 言語   | ビットレート | コーデック | DL ボタン
 *
 * DL ボタンはステップ12で有効化する。現時点では disabled プレースホルダー。
 *
 * @param {object} item      - 元の MPD アイテム（pageURL など引き継ぎ用）
 * @param {object} rep       - parseMpd の返す Representation オブジェクト
 * @param {"video"|"audio"} trackType
 */
function buildDashTrackItem(item, rep, trackType) {
  const li = document.createElement("li");
  li.className = "dash-track-item";

  // ── 主情報（解像度 or 言語） ──────────────────────────────────────────
  const infoEl = document.createElement("span");
  infoEl.className = "dash-track-info";
  if (trackType === "video") {
    infoEl.textContent = (rep.width && rep.height)
      ? `${rep.width}×${rep.height}`
      : "不明";
  } else {
    infoEl.textContent = rep.lang ? `${rep.lang}` : "音声";
  }

  // ── ビットレート ─────────────────────────────────────────────────────
  const bwEl = document.createElement("span");
  bwEl.className = "dash-track-bandwidth";
  bwEl.textContent = formatBandwidth(rep.bandwidth);

  // ── コーデック（上位識別子のみ、例: avc1 / mp4a） ──────────────────
  const codecEl = document.createElement("span");
  codecEl.className = "dash-track-codec";
  codecEl.textContent = rep.codecs
    ? rep.codecs.split(".")[0]   // "avc1.64001f" → "avc1"
    : "";

  // ── DL ボタン ────────────────────────────────────────────────────────
  const dashKey = `${item.url}::${rep.id}`;
  const dlBtn   = document.createElement("button");
  dlBtn.className         = "dl-btn";
  dlBtn.dataset.dashKey   = dashKey;
  dlBtn.dataset.trackType = trackType;
  // segInfo がない Representation はダウンロード不可
  dlBtn.disabled = !rep.segInfo;
  dlBtn.title    = rep.segInfo ? "ダウンロード" : "セグメント情報なし（ダウンロード不可）";

  // ポップアップを閉じて再度開いたとき、既存の状態を復元する
  applyDashDownloadButtonState(dlBtn, dashDownloadStates.get(dashKey));

  dlBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!rep.segInfo) return;
    startDashTrackDownload(item, rep, trackType, dlBtn);
  });

  li.appendChild(infoEl);
  li.appendChild(bwEl);
  if (codecEl.textContent) li.appendChild(codecEl);
  li.appendChild(dlBtn);

  return li;
}

/** DASH エラーコードを日本語メッセージに変換 */
function dashErrorMessage(error) {
  switch (error) {
    case "parse_failed":        return "MPD の解析に失敗しました";
    case "no_period":           return "Period 要素が見つかりません";
    case "no_representations":  return "ストリームが見つかりません";
    default:                    return `取得失敗: ${error ?? "不明なエラー"}`;
  }
}

// ─── DASH ダウンロード処理（ステップ12） ──────────────────────────────────────

/**
 * DASH トラックのセグメントダウンロードを開始する。
 * background に DOWNLOAD_DASH_TRACK を送り、完了までボタン状態を管理する。
 *
 * @param {object}           item      - 元の MPD アイテム（url / pageURL を参照）
 * @param {object}           rep       - Representation オブジェクト（segInfo 含む）
 * @param {"video"|"audio"}  trackType
 * @param {HTMLButtonElement} btn
 */
async function startDashTrackDownload(item, rep, trackType, btn) {
  const dashKey = `${item.url}::${rep.id}`;

  // 二重起動防止
  if (dashDownloadStates.get(dashKey)?.state === "fetching") return;

  // メタ情報を保存（DL パネルでの表示・リトライに使用）
  if (!dashDownloadMeta.has(dashKey)) {
    dashDownloadMeta.set(dashKey, { item, rep, trackType, detectedAt: Date.now() });
  }

  // 状態初期化してすぐ UI 更新
  const dds = { state: "fetching", current: 0, total: 0 };
  dashDownloadStates.set(dashKey, dds);
  applyDashDownloadButtonState(btn, dds);

  // mpdDuration は toggleDashAccordion 時に保存済み
  const mpdDuration = mpdDurationStore.get(item.url) ?? 0;

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:        "DOWNLOAD_DASH_TRACK",
      rep,
      mpdUrl:      item.url,
      mpdDuration,
      trackType,
      pageURL:     item.pageURL ?? "",
    });
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  if (result?.ok) {
    dds.state = "complete";
    applyDashDownloadButtonState(btn, dds);
    showDashSeparateNote(btn, trackType);
  } else {
    dds.state = "error";
    dds.error = result?.error ?? "unknown";
    applyDashDownloadButtonState(btn, dds);
  }

  if (activeFilter === "dl") renderDlPanel();
}

/**
 * data-dash-key 属性をもつ DL ボタンを検索して最新状態を反映する。
 * DASH_DOWNLOAD_PROGRESS コールバックから呼ばれる。
 *
 * @param {string} key - `${mpdUrl}::${repId}` 形式のキー
 */
function updateDashDownloadButton(key) {
  const btn = document.querySelector(
    `.dl-btn[data-dash-key="${CSS.escape(key)}"]`
  );
  if (!btn) return;
  applyDashDownloadButtonState(btn, dashDownloadStates.get(key));
}

/**
 * DASH ダウンロード状態に応じてボタンのテキスト・クラスを更新する。
 *
 * fetching : "x / y" または "…"（disabled）
 * complete : "✓ 完了"（disabled）
 * error    : "✗ エラー種別"（再クリック可能）
 *
 * @param {HTMLButtonElement} btn
 * @param {object|undefined}  dds - dashDownloadStates の値
 */
function applyDashDownloadButtonState(btn, dds) {
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");

  if (!dds) {
    // 未着手 — disabled 状態（segInfo なし）はそのまま維持
    if (!btn.disabled) btn.textContent = "↓ DL";
    return;
  }

  switch (dds.state) {
    case "fetching":
      btn.classList.add("dl-btn--downloading");
      btn.disabled    = true;
      btn.textContent = dds.total > 0
        ? `${dds.current} / ${dds.total}`
        : "…";
      break;

    case "complete":
      btn.classList.add("dl-btn--complete");
      btn.disabled    = true;
      btn.textContent = "✓ 完了";
      break;

    case "error": {
      const msg = dashDownloadErrorMessage(dds.error);
      btn.classList.add("dl-btn--error");
      btn.disabled    = false;
      btn.textContent = `✗ ${msg}`;
      btn.title       = msg;
      break;
    }

    default:
      if (!btn.disabled) btn.textContent = "↓ DL";
  }
}

// ─── DASH mux（v0.18.0） ──────────────────────────────────────────────────────

/**
 * DOWNLOAD_DASH_MUX を background に送り、mux を開始する。
 */
async function startDashMux(item, videoRep, audioRep, btn) {
  if (dashMuxStates.get(item.url)?.state === "fetching") return;

  if (!dashMuxMeta.has(item.url)) {
    dashMuxMeta.set(item.url, { item, videoRep, audioRep, detectedAt: Date.now() });
  }

  const mds = { state: "fetching", phase: "video", current: 0, total: 0 };
  dashMuxStates.set(item.url, mds);
  applyDashMuxButtonState(btn, mds);

  const mpdDuration = mpdDurationStore.get(item.url) ?? 0;

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:        "DOWNLOAD_DASH_MUX",
      videoRep,
      audioRep,
      mpdUrl:      item.url,
      mpdDuration,
      pageURL:     item.pageURL ?? "",
    });
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  if (result?.ok) {
    mds.state = "complete";
    mds.muxed = result.muxed ?? false;
  } else {
    mds.state = "error";
    mds.error = result?.error ?? "unknown";
  }
  applyDashMuxButtonState(btn, mds);
  if (activeFilter === "dl") renderDlPanel();
}

/** data-mpd-url をもつ mux ボタンを探して状態を更新する */
function updateDashMuxButton(mpdUrl) {
  const btn = document.querySelector(`.dash-mux-btn[data-mpd-url="${CSS.escape(mpdUrl)}"]`);
  if (btn) applyDashMuxButtonState(btn, dashMuxStates.get(mpdUrl));
}

/** DASH mux ボタンの表示を状態に合わせて更新する */
function applyDashMuxButtonState(btn, mds) {
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");
  btn.disabled = false;

  if (!mds) {
    btn.textContent = "⊕ mux DL";
    return;
  }

  switch (mds.state) {
    case "fetching": {
      btn.classList.add("dl-btn--downloading");
      btn.disabled = true;
      const phaseLabel = { video: "映像取得", audio: "音声取得", muxing: "mux中" }[mds.phase] ?? "処理中";
      btn.textContent = mds.total > 0
        ? `${phaseLabel} ${mds.current}/${mds.total}`
        : `${phaseLabel}…`;
      break;
    }
    case "complete":
      btn.classList.add("dl-btn--complete");
      btn.disabled = true;
      btn.textContent = mds.muxed ? "✓ mux完了 (.mp4)" : "✓ 別ファイルDL完了";
      break;
    case "error":
      btn.classList.add("dl-btn--error");
      btn.textContent = `✗ ${mds.error ?? "エラー"}`;
      break;
    default:
      btn.textContent = "⊕ mux DL";
  }
}

/** DASH ダウンロードエラーコードを日本語に変換 */
function dashDownloadErrorMessage(error) {
  switch (error) {
    case "no_segments": return "セグメントなし";
    default:            return error ?? "不明なエラー";
  }
}

/**
 * ダウンロード完了後にボタンの下へ「映像のみ / 音声のみ」の注記を表示する。
 * DASH の映像・音声は別ファイルで保存されるため VLC 等で結合が必要。
 *
 * @param {HTMLButtonElement} btn
 * @param {"video"|"audio"}   trackType
 */
function showDashSeparateNote(btn, trackType) {
  if (btn.parentElement?.querySelector(".dash-dl-note")) return;
  const note = document.createElement("span");
  note.className   = "dash-dl-note";
  note.textContent = trackType === "video"
    ? "⚠ 映像のみ（無音）— FFmpeg ステップで統合予定"
    : "⚠ 音声のみ — FFmpeg ステップで統合予定";
  btn.insertAdjacentElement("afterend", note);
}

/** 帯域幅を人間が読みやすい単位に変換（Kbps / Mbps）*/
function formatBandwidth(bps) {
  if (!bps) return "";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1_000)} Kbps`;
}

/**
 * m3u8 アイテムのアコーディオン展開・折りたたみをトグルする。
 * 展開済みなら折りたたむ、未展開なら FETCH_HLS_VARIANTS を送信して展開する。
 */
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

// ─── サムネイルキュー ─────────────────────────────────────────────────────────
/**
 * サムネイル取得は content.js の隠れ <video> を使うため、同時に複数走ると
 * ページの帯域・CPU を圧迫する。ここでは最大 2 並列に制限するキューを使う。
 */
const THUMB_CONCURRENCY = 2;
let thumbRunning = 0;
const thumbQueue = []; // { url, tabId, imgEl } の配列

function enqueueThumb(url, tabId, imgEl) {
  thumbQueue.push({ url, tabId, imgEl });
  drainThumbQueue();
}

function drainThumbQueue() {
  while (thumbRunning < THUMB_CONCURRENCY && thumbQueue.length > 0) {
    const task = thumbQueue.shift();
    thumbRunning++;
    fetchThumb(task).finally(() => {
      thumbRunning--;
      drainThumbQueue();
    });
  }
}

/**
 * content.js に CAPTURE_THUMBNAIL を送信し、返ってきた dataURL を
 * img 要素に反映する。成功したら background にもキャッシュ保存する。
 */
async function fetchThumb({ url, tabId, imgEl }) {
  try {
    const res = await browser.tabs.sendMessage(tabId, {
      type: "CAPTURE_THUMBNAIL",
      url,
    });
    if (res?.ok && res.dataURL) {
      imgEl.src = res.dataURL;
      imgEl.classList.add("thumb-img--loaded");
      // background にキャッシュ（ポップアップを閉じても保持）
      browser.runtime.sendMessage({
        type:   "SET_THUMBNAIL",
        tabId,
        url,
        dataURL: res.dataURL,
      }).catch(() => {});
    } else {
      // CORS / タイムアウト → プレースホルダーのまま（エラー表示は不要）
      imgEl.classList.add("thumb-img--failed");
    }
  } catch (_) {
    imgEl.classList.add("thumb-img--failed");
  }
}



// ─── HLS バリアント専用ダウンロードボタン ─────────────────────────────────────

/**
 * HLS バリアント（Media Playlist URL）用の DL ボタンを生成する。
 * 通常の browser.downloads とは別フロー（DOWNLOAD_HLS_SEGMENTS）を使うため、
 * buildDownloadButton とは独立した実装にする。
 *
 * @param {object} item         - 元アイテム（pageURL など引き継ぐ）
 * @param {string} variantUrl   - バリアントの Media Playlist URL
 */
function buildHlsVariantDownloadButton(item, variantUrl) {
  const btn = document.createElement("button");
  btn.className = "dl-btn";
  btn.dataset.url = variantUrl;
  btn.title = "HLS セグメントをダウンロード";

  const hds = hlsDownloadStates.get(variantUrl);
  applyHlsDownloadButtonState(btn, hds);

  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // アコーディオンのトグルを防ぐ
    startHlsSegmentDownload(item, variantUrl, btn);
  });

  return btn;
}

/**
 * DOWNLOAD_HLS_SEGMENTS を background に送り、セグメントダウンロードを開始する。
 */
async function startHlsSegmentDownload(item, variantUrl, btn) {
  const existing = hlsDownloadStates.get(variantUrl);
  if (existing && existing.state === "fetching") return; // 二重起動防止

  // メタ情報を保存（DL パネルでの表示・リトライに使用）
  if (!hlsDownloadMeta.has(variantUrl)) {
    hlsDownloadMeta.set(variantUrl, { item, detectedAt: Date.now() });
  }

  // 状態を初期化してすぐ UI を更新
  const hds = { state: "fetching", current: 0, total: 0 };
  hlsDownloadStates.set(variantUrl, hds);
  applyHlsDownloadButtonState(btn, hds);

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:    "DOWNLOAD_HLS_SEGMENTS",
      url:     variantUrl,
      pageURL: item.pageURL ?? "",
      tabId:   currentTabId,
    });
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  if (result?.ok) {
    // ── ステップ10: ライブストリーム ─────────────────────────────────────────
    if (result.live) {
      // hlsDownloadStates からは外してライブ状態管理に移行
      hlsDownloadStates.delete(variantUrl);
      const lrs = {
        state:         "recording",
        totalSegments: 0,
        chunkIndex:    0,
        stem:          "",
      };
      liveRecordingStates.set(variantUrl, lrs);
      buildLiveRecordingBanner();
      applyLiveRecordingButtonState(btn, lrs, variantUrl);
      if (activeFilter === "dl") renderDlPanel();
      return;
    }
    // ── VOD 完了 ─────────────────────────────────────────────────────────────
    hds.state = "complete";
    // companion（FFmpeg）経由の変換完了は .mp4 なので .ts 注記は不要
    if (!hds.converting) showHlsTsNote(btn);
  } else {
    hds.state = "error";
    hds.error = result?.error ?? "unknown";
  }

  applyHlsDownloadButtonState(btn, hds);
  if (activeFilter === "dl") renderDlPanel();
}

/**
 * URL をキーにして HLS DL ボタン DOM を探し、最新状態を反映する。
 * HLS_DOWNLOAD_PROGRESS コールバックから呼ばれる。
 */
function updateHlsDownloadButton(url) {
  // バリアントボタンは hls-variants リスト内にある
  const btn = document.querySelector(`.hls-variants .dl-btn[data-url="${CSS.escape(url)}"]`);
  if (!btn) return;
  applyHlsDownloadButtonState(btn, hlsDownloadStates.get(url));
}

/**
 * HLS ダウンロード状態に応じてボタンのテキスト・クラスを更新する。
 *
 * state === "fetching":
 *   total が不明（0）なら「…」、判明後は「x / y」セグメント表示
 * state === "complete":
 *   「✓ 完了」
 * state === "error":
 *   エラー種別に応じた日本語メッセージ
 */
function applyHlsDownloadButtonState(btn, hds) {
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");
  btn.disabled = false;

  if (!hds) {
    btn.textContent = "↓ DL";
    return;
  }

  switch (hds.state) {
    case "fetching": {
      btn.classList.add("dl-btn--downloading");
      btn.disabled = true;
      // ステップ16: FFmpeg 変換フェーズか、セグメント取得フェーズかで表示を切り替え
      if (hds.converting) {
        // companion による FFmpeg 変換中（current = 進捗 %, total = 100）
        btn.textContent = hds.current < 100
          ? `⚡ ${hds.current}%`
          : "⚡ 変換中…";
      } else if (hds.total > 0) {
        btn.textContent = `${hds.current} / ${hds.total}`;
      } else {
        btn.textContent = "…";
      }
      break;
    }
    case "complete":
      btn.textContent = "✓ 完了";
      btn.classList.add("dl-btn--complete");
      btn.disabled = true;
      break;
    case "error": {
      const msg = hlsErrorMessage(hds.error);
      btn.textContent = `✗ ${msg}`;
      btn.classList.add("dl-btn--error");
      btn.title = msg;
      break;
    }
    default:
      btn.textContent = "↓ DL";
  }
}

/**
 * HLS ダウンロード完了後にボタン下へ注記を表示する。
 * .ts ファイルは QuickTime・ブラウザでは再生できず、VLC 等が必要なため。
 */
function showHlsTsNote(btn) {
  // すでに注記があればスキップ
  if (btn.parentElement?.querySelector(".hls-ts-note")) return;

  const note = document.createElement("span");
  note.className = "hls-ts-note";
  note.textContent = "⚠ .ts 形式 — VLC / mpv で再生可";
  btn.insertAdjacentElement("afterend", note);
}

/** エラーコードを日本語メッセージに変換 */
function hlsErrorMessage(error) {
  switch (error) {
    case "encrypted":       return "暗号化ストリームは未対応";   // 旧コード（念のため残す）
    case "sample_aes":      return "DRM 保護コンテンツは未対応";
    case "no_segments":     return "セグメントなし";
    case "master_playlist": return "画質を選択してください";
    default:                return `エラー: ${error ?? "不明"}`;
  }
}

// ─── DL パネル（ステップ14） ──────────────────────────────────────────────────

/**
 * 全ダウンロード状態マップを統合してエントリ配列を生成する。
 * 新しい開始順に並ぶ（detectedAt 降順）。
 */
function gatherDlEntries() {
  const entries = [];

  // 直接ダウンロード
  for (const [url, ds] of downloadStates) {
    const meta = downloadMeta.get(url);
    entries.push({
      key:        url,
      kind:       "direct",
      filename:   extractFilename(url),
      state:      ds.state,
      progress:   ds.progress ?? 0,
      downloadId: ds.downloadId,
      item:       meta?.item,
      detectedAt: meta?.detectedAt ?? 0,
    });
  }

  // HLS VOD セグメントダウンロード
  for (const [url, hds] of hlsDownloadStates) {
    const meta = hlsDownloadMeta.get(url);
    entries.push({
      key:        url,
      kind:       "hls",
      filename:   extractFilename(url),
      state:      hds.state,
      current:    hds.current,
      total:      hds.total,
      error:      hds.error,
      item:       meta?.item,
      detectedAt: meta?.detectedAt ?? 0,
    });
  }

  // DASH トラックダウンロード
  for (const [key, dds] of dashDownloadStates) {
    const meta = dashDownloadMeta.get(key);
    const suffix = meta?.trackType === "video" ? " [映像]"
                 : meta?.trackType === "audio" ? " [音声]"
                 : "";
    entries.push({
      key,
      kind:       "dash",
      filename:   (meta ? extractFilename(meta.item?.url ?? "") : key) + suffix,
      state:      dds.state,
      current:    dds.current,
      total:      dds.total,
      error:      dds.error,
      item:       meta?.item,
      rep:        meta?.rep,
      trackType:  meta?.trackType,
      detectedAt: meta?.detectedAt ?? 0,
    });
  }

  // ライブ録画セッション
  for (const [url, lrs] of liveRecordingStates) {
    entries.push({
      key:           url,
      kind:          "live",
      filename:      lrs.stem || extractFilename(url),
      state:         lrs.state,
      totalSegments: lrs.totalSegments,
      chunkIndex:    lrs.chunkIndex,
      detectedAt:    0,
    });
  }

  // 新しい順（detectedAt 降順）
  entries.sort((a, b) => (b.detectedAt - a.detectedAt));
  return entries;
}

/** DL エントリの総件数を返す（タブバッジのカウント用）*/
function countDlEntries() {
  return downloadStates.size + hlsDownloadStates.size +
         dashDownloadStates.size + liveRecordingStates.size;
}

/** DL パネルを全面再描画する */
function renderDlPanel() {
  elDlPanel.innerHTML = "";

  const entries = gatherDlEntries();

  // ── ツールバー（件数 + 完了をクリアボタン） ──────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "dl-panel-toolbar";

  const countEl = document.createElement("span");
  countEl.className = "dl-panel-count";
  countEl.textContent = `${entries.length} 件`;

  const clearBtn = document.createElement("button");
  clearBtn.className = "dl-clear-btn";
  clearBtn.textContent = "完了をクリア";
  const hasCompleted = entries.some(e =>
    e.state === "complete" || e.state === "interrupted" ||
    e.state === "stopped"  || e.state === "ended"
  );
  clearBtn.disabled = !hasCompleted;
  clearBtn.addEventListener("click", () => {
    clearCompletedDownloads();
    renderDlPanel();
    // フッター件数も更新
    elCount.textContent = `${countDlEntries()} 件のDL`;
  });

  toolbar.appendChild(countEl);
  toolbar.appendChild(clearBtn);
  elDlPanel.appendChild(toolbar);

  // ── エントリが0件のとき ────────────────────────────────────────────────
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dl-empty";
    empty.textContent = "ダウンロード履歴がありません";
    elDlPanel.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    elDlPanel.appendChild(buildDlEntry(entry));
  }
}

/**
 * DL エントリ1件分の DOM を構築して返す。
 * @param {object} entry - gatherDlEntries() が返すエントリオブジェクト
 */
function buildDlEntry(entry) {
  const div = document.createElement("div");
  div.className = "dl-entry";

  // ── ヘッダー行: タイプバッジ + ファイル名 + アクションボタン ──────────────
  const header = document.createElement("div");
  header.className = "dl-entry-header";

  // タイプバッジ
  const badge = document.createElement("span");
  badge.className = `dl-type-badge dl-type-badge--${entry.kind}`;
  badge.textContent = { direct: "直接", hls: "HLS", dash: "DASH", live: "LIVE" }[entry.kind] ?? entry.kind;

  // ファイル名
  const filenameEl = document.createElement("span");
  filenameEl.className = "dl-entry-filename";
  filenameEl.textContent = entry.filename;
  filenameEl.title = entry.key;

  // アクションボタン群
  const actionArea = document.createElement("div");
  actionArea.className = "dl-entry-actions";

  // キャンセルボタン（直接DLのみ、ダウンロード中）
  if (entry.kind === "direct" && entry.state === "downloading" && entry.downloadId != null) {
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "dl-action-btn dl-action-btn--cancel";
    cancelBtn.textContent = "✕";
    cancelBtn.title = "キャンセル";
    cancelBtn.addEventListener("click", () => {
      browser.downloads.cancel(entry.downloadId).catch(() => {});
      const ds = downloadStates.get(entry.key);
      if (ds) ds.state = "interrupted";
      renderDlPanel();
    });
    actionArea.appendChild(cancelBtn);
  }

  // リトライボタン（エラー / 中断時）
  if (entry.state === "error" || entry.state === "interrupted") {
    const retryBtn = document.createElement("button");
    retryBtn.className = "dl-action-btn dl-action-btn--retry";
    retryBtn.textContent = "↺ 再試行";
    retryBtn.addEventListener("click", () => retryDownload(entry));
    actionArea.appendChild(retryBtn);
  }

  header.appendChild(badge);
  header.appendChild(filenameEl);
  header.appendChild(actionArea);
  div.appendChild(header);

  // ── ステータス行 + プログレスバー ─────────────────────────────────────────
  const statusRow = document.createElement("div");
  statusRow.className = "dl-entry-status-row";

  const statusEl = document.createElement("span");
  statusEl.className = "dl-entry-status";
  statusEl.textContent = getDlEntryStatusText(entry);
  statusRow.appendChild(statusEl);

  // プログレスバー（進捗が判明している場合のみ）
  if (dlEntryNeedsBar(entry)) {
    const bar = document.createElement("div");
    bar.className = "dl-progress-bar";
    const fill = document.createElement("div");
    fill.className = "dl-progress-fill";
    fill.style.width = `${getDlEntryPercent(entry)}%`;
    bar.appendChild(fill);
    statusRow.appendChild(bar);
  }

  div.appendChild(statusRow);
  return div;
}

/** エントリのステータス文字列を返す */
function getDlEntryStatusText(entry) {
  switch (entry.kind) {
    case "direct":
      switch (entry.state) {
        case "downloading": return entry.progress > 0 ? `${entry.progress}%` : "ダウンロード中…";
        case "complete":    return "✓ 完了";
        case "error":       return "✗ エラー（再試行可）";
        case "interrupted": return "✗ 中断（再試行可）";
        default:            return "待機中";
      }
    case "hls":
      switch (entry.state) {
        case "fetching":
          // ステップ16: FFmpeg 変換フェーズか通常セグメント取得かで表示を切り替え
          if (entry.converting) {
            return entry.current < 100
              ? `⚡ FFmpeg 変換中… ${entry.current}%`
              : "⚡ FFmpeg 変換中…";
          }
          return entry.total > 0
            ? `取得中… ${entry.current} / ${entry.total} セグメント`
            : "セグメント取得中…";
        case "complete":  return entry.converting ? "✓ 完了 (.mp4)" : "✓ 完了 (.ts)";
        case "error":     return `✗ ${hlsErrorMessage(entry.error)}`;
        default:          return "待機中";
      }
    case "dash":
      switch (entry.state) {
        case "fetching":  return entry.total > 0
          ? `取得中… ${entry.current} / ${entry.total} セグメント`
          : "セグメント取得中…";
        case "complete":  return "✓ 完了（映像/音声別）";
        case "error":     return `✗ ${dashDownloadErrorMessage(entry.error)}`;
        default:          return "待機中";
      }
    case "live":
      switch (entry.state) {
        case "recording": return `● 録画中 — ${entry.totalSegments} セグメント`;
        case "stopped":   return `✓ 録画停止 — ${entry.totalSegments} セグメント`;
        case "ended":     return `✓ 録画完了 — ${entry.chunkIndex} ファイル`;
        default:          return "不明";
      }
    default:
      return "";
  }
}

/** プログレスバーが必要かどうか */
function dlEntryNeedsBar(entry) {
  if (entry.kind === "direct" && entry.state === "downloading" && entry.progress > 0) return true;
  if ((entry.kind === "hls" || entry.kind === "dash") &&
      entry.state === "fetching" && entry.total > 0) return true;
  return false;
}

/** プログレスバーのパーセント（0〜100）を返す */
function getDlEntryPercent(entry) {
  if (entry.kind === "direct") return entry.progress;
  if (entry.total > 0) return Math.round((entry.current / entry.total) * 100);
  return 0;
}

/**
 * ダウンロードをリトライする。
 * 状態をリセットして元のダウンロード関数を再呼び出しする。
 * ボタンは DL パネル内に存在しないため、ダミー要素を使う。
 */
function retryDownload(entry) {
  const fakeBtn = document.createElement("button");

  if (entry.kind === "direct" && entry.item) {
    downloadStates.delete(entry.key);
    startDownload(entry.item, fakeBtn);
  } else if (entry.kind === "hls" && entry.item) {
    hlsDownloadStates.delete(entry.key);
    startHlsSegmentDownload(entry.item, entry.key, fakeBtn);
  } else if (entry.kind === "dash" && entry.item && entry.rep) {
    dashDownloadStates.delete(entry.key);
    startDashTrackDownload(entry.item, entry.rep, entry.trackType, fakeBtn);
  }

  // 即時 UI 反映
  renderDlPanel();
}

/**
 * 完了・失敗・停止状態のエントリを全マップから除去する。
 * 「完了をクリア」ボタンから呼ばれる。
 */
function clearCompletedDownloads() {
  for (const [url, ds] of [...downloadStates]) {
    if (ds.state !== "downloading") {
      downloadStates.delete(url);
      downloadMeta.delete(url);
      if (ds.downloadId != null) downloadIdToUrl.delete(ds.downloadId);
    }
  }
  for (const [url, hds] of [...hlsDownloadStates]) {
    if (hds.state !== "fetching") {
      hlsDownloadStates.delete(url);
      hlsDownloadMeta.delete(url);
    }
  }
  for (const [key, dds] of [...dashDownloadStates]) {
    if (dds.state !== "fetching") {
      dashDownloadStates.delete(key);
      dashDownloadMeta.delete(key);
    }
  }
  for (const [url, lrs] of [...liveRecordingStates]) {
    if (lrs.state !== "recording") {
      liveRecordingStates.delete(url);
    }
  }
}

// ─── ライブ録画 UI（ステップ10） ──────────────────────────────────────────────

/**
 * ライブバナーを全面的に再構築する。
 * recording 状態のセッションが1件以上あれば表示、なければ非表示にする。
 */
function buildLiveRecordingBanner() {
  elLiveBanner.innerHTML = "";

  const activeSessions = [...liveRecordingStates.entries()]
    .filter(([, lrs]) => lrs.state === "recording");

  if (activeSessions.length === 0) {
    elLiveBanner.classList.add("hidden");
    return;
  }

  elLiveBanner.classList.remove("hidden");

  for (const [url, lrs] of activeSessions) {
    const item = document.createElement("div");
    item.className = "live-banner-item";

    // 点滅ドット
    const dot = document.createElement("span");
    dot.className = "live-dot";

    // ラベル（ファイル名ステム or URL）
    const label = document.createElement("span");
    label.className = "live-banner-label";
    label.textContent = lrs.stem || extractFilename(url);
    label.title = url;

    // 統計（セグメント数 / チャンク数）
    const stats = document.createElement("span");
    stats.className = "live-banner-stats";
    stats.dataset.url = url;
    stats.textContent = formatLiveStats(lrs);

    // 停止ボタン
    const stopBtn = document.createElement("button");
    stopBtn.className = "live-stop-btn";
    stopBtn.textContent = "■ 停止";
    stopBtn.addEventListener("click", () => stopLiveRecordingFromPopup(url));

    item.appendChild(dot);
    item.appendChild(label);
    item.appendChild(stats);
    item.appendChild(stopBtn);
    elLiveBanner.appendChild(item);
  }
}

/** ライブ統計テキストを生成 */
function formatLiveStats(lrs) {
  const segs   = lrs.totalSegments;
  const chunks = lrs.chunkIndex;
  if (chunks === 0) return `${segs} seg`;
  return `${segs} seg / ${chunks} ファイル`;
}

/**
 * URL で特定のバナー行の統計テキストだけを更新する。
 * バナー全体の再構築より軽い。
 */
function updateLiveBannerStats(url) {
  const statsEl = elLiveBanner.querySelector(`.live-banner-stats[data-url="${CSS.escape(url)}"]`);
  if (!statsEl) return;
  const lrs = liveRecordingStates.get(url);
  if (lrs) statsEl.textContent = formatLiveStats(lrs);
}

/**
 * バリアントリスト内の DL ボタンを取得し、ライブ状態を反映する。
 * バナーとは別に、アコーディオンが開いている場合のみ更新される。
 */
function updateLiveRecordingButton(url) {
  const btn = document.querySelector(`.hls-variants .dl-btn[data-url="${CSS.escape(url)}"]`);
  if (!btn) return;
  const lrs = liveRecordingStates.get(url);
  if (lrs) applyLiveRecordingButtonState(btn, lrs, url);
}

/**
 * バリアント DL ボタンをライブ録画状態に応じて更新する。
 *
 * state === "recording" : 「■ 停止（xx seg）」— クリックで停止
 * state === "stopped"   : 「✓ 録画停止」
 * state === "ended"     : 「✓ 録画完了」（ストリーム側が終了）
 *
 * @param {HTMLButtonElement} btn
 * @param {object}            lrs        - liveRecordingStates の値
 * @param {string}            variantUrl
 */
function applyLiveRecordingButtonState(btn, lrs, variantUrl) {
  btn.classList.remove(
    "dl-btn--downloading", "dl-btn--complete", "dl-btn--error", "dl-btn--live"
  );
  btn.disabled = false;
  // 既存の onclick を解除
  btn.onclick = null;

  switch (lrs.state) {
    case "recording":
      btn.classList.add("dl-btn--live");
      btn.textContent = `■ 停止 (${lrs.totalSegments}seg)`;
      btn.title = "クリックして録画を停止";
      btn.onclick = (e) => {
        e.stopPropagation();
        stopLiveRecordingFromPopup(variantUrl);
      };
      break;

    case "stopped":
      btn.classList.add("dl-btn--complete");
      btn.textContent = "✓ 録画停止";
      btn.disabled = true;
      showHlsTsNote(btn);
      break;

    case "ended":
      btn.classList.add("dl-btn--complete");
      btn.textContent = `✓ 録画完了 (${lrs.chunkIndex}ch)`;
      btn.disabled = true;
      showHlsTsNote(btn);
      break;
  }
}

/**
 * ポップアップの停止ボタンから呼ばれる。
 * STOP_LIVE_RECORDING を background に送信して録画を終了する。
 */
async function stopLiveRecordingFromPopup(url) {
  // 楽観的 UI 更新（レスポンスを待たず即反映）
  const lrs = liveRecordingStates.get(url);
  if (lrs) {
    lrs.state = "stopped";
    buildLiveRecordingBanner();
    updateLiveRecordingButton(url);
  }

  try {
    await browser.runtime.sendMessage({ type: "STOP_LIVE_RECORDING", url });
  } catch (_) {}
}

/**
 * ボタンには data-url 属性を付け、updateDownloadButton() で参照できるようにする。
 */
function buildDownloadButton(item) {
  const btn = document.createElement("button");
  btn.className = "dl-btn";
  btn.dataset.url = item.url;
  btn.title = "ダウンロード";

  // m3u8 は既定DLでも変換経路に回す（companion 接続時は1本のMP4、未接続時は
  // 結合した .ts）。生の .m3u8 テキストを保存しても使えないため。
  const isHls = isHlsUrl(item.url) || (item.mimeHint || "").includes("mpegurl");

  if (isHls) {
    applyHlsDownloadButtonState(btn, hlsDownloadStates.get(item.url));
    btn.addEventListener("click", () => startHlsSegmentDownload(item, item.url, btn));
  } else {
    applyDownloadButtonState(btn, downloadStates.get(item.url));
    btn.addEventListener("click", () => startDownload(item, btn));
  }

  return btn;
}

/**
 * ダウンロードを開始する。
 * background に DOWNLOAD_MEDIA メッセージを送り、返ってきた downloadId を保存する。
 */
async function startDownload(item, btn) {
  // すでにダウンロード中・完了済みの場合は再ダウンロードしない
  const existing = downloadStates.get(item.url);
  if (existing && existing.state === "downloading") return;

  // メタ情報を保存（DL パネルでの表示・リトライに使用）
  if (!downloadMeta.has(item.url)) {
    downloadMeta.set(item.url, { item, detectedAt: Date.now() });
  }

  // 状態を初期化してすぐ UI を更新
  const ds = { downloadId: null, state: "downloading", progress: 0 };
  downloadStates.set(item.url, ds);
  applyDownloadButtonState(btn, ds);

  try {
    const res = await browser.runtime.sendMessage({
      type:     "DOWNLOAD_MEDIA",
      url:      item.url,
      mimeHint: item.mimeHint ?? "",
      pageURL:  item.pageURL  ?? "",  // Referer として使う元ページ URL
    });

    if (res?.ok) {
      ds.downloadId = res.downloadId;
      downloadIdToUrl.set(res.downloadId, item.url);
    } else {
      ds.state = "error";
      applyDownloadButtonState(btn, ds);
    }
  } catch (_) {
    ds.state = "error";
    applyDownloadButtonState(btn, ds);
  }

  if (activeFilter === "dl") renderDlPanel();
}

/**
 * URL をキーにしてボタン DOM を探し、最新の downloadStates を反映する。
 * （onChanged コールバックから呼ばれる）
 */
function updateDownloadButton(url) {
  const btn = elList.querySelector(`.dl-btn[data-url="${CSS.escape(url)}"]`);
  if (!btn) return;
  applyDownloadButtonState(btn, downloadStates.get(url));
}

/**
 * ダウンロード状態に応じてボタンのテキスト・クラスを設定する。
 */
function applyDownloadButtonState(btn, ds) {
  // リセット
  btn.classList.remove("dl-btn--downloading", "dl-btn--complete", "dl-btn--error");
  btn.disabled = false;

  if (!ds) {
    // 未着手
    btn.textContent = "↓ DL";
    return;
  }

  switch (ds.state) {
    case "downloading":
      btn.textContent = ds.progress > 0 ? `${ds.progress}%` : "…";
      btn.classList.add("dl-btn--downloading");
      btn.disabled = true;
      break;
    case "complete":
      btn.textContent = "✓ 完了";
      btn.classList.add("dl-btn--complete");
      btn.disabled = true;
      break;
    case "error":
    case "interrupted":
      btn.textContent = "✗ 再試行";
      btn.classList.add("dl-btn--error");
      break;
    default:
      btn.textContent = "↓ DL";
  }
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

/**
 * 画面下部に短時間トースト通知を表示する。
 * @param {string} msg
 */
function showToast(msg) {
  let toast = document.getElementById("ms-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "ms-toast";
    toast.style.cssText = [
      "position:fixed;bottom:12px;left:50%;transform:translateX(-50%)",
      "background:#333;color:#fff;font-size:12px;padding:6px 14px",
      "border-radius:4px;z-index:9999;pointer-events:none;opacity:0",
      "transition:opacity .2s;max-width:90%;text-align:center",
    ].join(";");
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 2500);
}

function makeChip(text) {
  const span = document.createElement("span");
  span.className = "meta-chip";
  span.textContent = text;
  return span;
}

/** URL からドメイン部分を取得 */
function extractDomain(url) {
  try { return new URL(url).hostname; }
  catch (_) { return ""; }
}

/** URL からファイル名（パスの末尾）を取得 */
function extractFilename(url) {
  try {
    const path = new URL(url).pathname;
    const name = path.split("/").filter(Boolean).pop() ?? "";
    return name || url;
  } catch (_) {
    return url;
  }
}

/** URL から拡張子を取得 */
function extractExt(url) {
  return (url.match(/\.([a-z0-9]+)(\?|#|$)/i) ?? [])[1] ?? null;
}

/** バイト数を人間が読みやすい文字列に変換 */
function formatSize(bytes) {
  if (bytes == null) return "不明";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** クリップボードにコピー */
async function copyURL(url, btn) {
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "✓ コピー済み";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "コピー";
      btn.classList.remove("copied");
    }, 1500);
  } catch (_) {
    const el = document.createElement("textarea");
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

// ─── 起動 ────────────────────────────────────────────────────────────────────
init();
