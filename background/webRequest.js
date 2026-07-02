// background/webRequest.js — MimicVault
// webRequest リスナ（Referer 注入・ネットワーク傍受）と handleNetworkResponse

"use strict";

// ─── webRequest — Referer 注入（ステップ6） ──────────────────────────────────
/**
 * browser.downloads.download() はカスタムリクエストヘッダを指定する API を持たない。
 * そのため onBeforeSendHeaders（blocking）でリクエストを横取りし、
 * pendingReferers に登録されている URL なら Referer を書き換えて返す。
 *
 * extraInfoSpec に "blocking" と "requestHeaders" が必要。
 * これが MV2 を選んだ理由のひとつ（MV3 では blocking が使えない）。
 */
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const referer = pendingReferers.get(details.url);
    if (!referer) return {}; // 対象外のリクエストはそのまま通す

    // 注入は1回だけでよいので即削除
    pendingReferers.delete(details.url);

    const headers = details.requestHeaders ?? [];

    // 既存の Referer ヘッダがあれば上書き、なければ追加
    const idx = headers.findIndex(h => h.name.toLowerCase() === "referer");
    if (idx >= 0) {
      headers[idx].value = referer;
    } else {
      headers.push({ name: "Referer", value: referer });
    }

    return { requestHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

// ─── webRequest — ネットワーク傍受（ステップ2 のメイン追加） ─────────────────

/**
 * onResponseStarted を使う理由:
 *   onBeforeRequest の時点では Content-Type ヘッダがまだ存在しない。
 *   ヘッダが揃ったこのタイミングで MIME + URL の両方を検査する。
 *
 * 監視するリソースタイプ:
 *   "media"          — <video src> / <audio src> 等のメディア要素
 *   "xmlhttprequest" — XHR 経由フェッチ（HLS セグメントなど）
 *   "object"         — <object> / <embed> 系
 *   "other"          — fetch() API 経由など
 */
browser.webRequest.onResponseStarted.addListener(
  handleNetworkResponse,
  {
    urls: ["<all_urls>"],
    types: ["media", "xmlhttprequest", "object", "other"],
  },
  ["responseHeaders"]
);

function handleNetworkResponse(details) {
  // tabId === -1 は拡張機能自身のバックグラウンドリクエスト（除外）
  if (details.tabId === -1) return;

  const { url, tabId, responseHeaders = [] } = details;

  // ステップ18: ドメインブラック/ホワイトリストで除外
  if (isDomainFiltered(url)) return;

  const contentType   = getHeader(responseHeaders, "content-type") ?? "";
  const contentLength = Number(getHeader(responseHeaders, "content-length") ?? -1);

  // 除外: 明らかに非メディアな MIME
  if (EXCLUDE_MIME_RE.test(contentType)) return;

  // 除外: サイズが取れていて最小値未満
  // ステップ18: 設定の minSizeKB を優先（0 の場合は無制限 = 下限なし）
  const minBytes = Math.max(0, (settingsCache.minSizeKB ?? 0) * 1024);
  if (contentLength > 0 && minBytes > 0 && contentLength < minBytes) return;
  // 従来のハード下限は minSizeKB が 0 の場合にのみ適用（保険）
  if (minBytes === 0 && contentLength > 0 && contentLength < MIN_CONTENT_LENGTH) return;

  const isMimeMedia    = MEDIA_MIME_RE.test(contentType);
  const isMimeManifest = MANIFEST_MIME_RE.test(contentType);
  const isUrlMedia     = MEDIA_URL_RE.test(url);

  if (!isMimeMedia && !isMimeManifest && !isUrlMedia) return;

  // "video/mp4; codecs=avc1.64001f" → "video/mp4" に正規化
  const mimeHint = (isMimeMedia || isMimeManifest)
    ? contentType.split(";")[0].trim()
    : inferMimeFromUrl(url);

  addToStore(tabId, {
    url,
    source:        "network",
    tag:           resolveTag(mimeHint),
    mimeHint,
    contentLength: contentLength > 0 ? contentLength : null,  // null = 不明
    pageTitle:     "",
    pageURL:       details.documentUrl ?? "",
    detectedAt:    Date.now(),
  });
}

