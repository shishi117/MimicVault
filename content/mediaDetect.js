// content/mediaDetect.js — MimicVault
// DOM 走査によるメディア検出 toAbsoluteURL/isMediaCandidate/collectMediaFromDOM/inferMime/sendToBackground

"use strict";

// ─── 設定 ────────────────────────────────────────────────────────────────────

/** src として認識する拡張子のパターン */
const MEDIA_EXTENSIONS = /\.(mp4|webm|mkv|mov|avi|ogg|ogv|flv|m4v|m3u8|mpd)(\?|$)/i;

/** Content-Type に相当するタグ属性 type の許可パターン */
const MEDIA_TYPES = /^video\/|^audio\//i;

// ─── URL の正規化 ─────────────────────────────────────────────────────────────

/**
 * src 属性値を絶対 URL に変換する。
 * blob: / data: は収集対象外（後のステップで対応）。
 */
function toAbsoluteURL(src) {
  if (!src) return null;
  if (src.startsWith("blob:") || src.startsWith("data:")) return null;
  try {
    return new URL(src, document.baseURI).href;
  } catch (_) {
    return null;
  }
}

// ─── メディア候補の判定 ───────────────────────────────────────────────────────

/**
 * URL または type 属性からメディアファイルかどうかを判定する。
 */
function isMediaCandidate(src, type) {
  if (type && MEDIA_TYPES.test(type)) return true;
  if (src && MEDIA_EXTENSIONS.test(src)) return true;
  return false;
}

// ─── DOM 走査 ────────────────────────────────────────────────────────────────

/**
 * ページ内の全メディア要素を走査して候補 URL を収集する。
 *
 * 収集対象:
 *   - <video src="...">
 *   - <audio src="...">
 *   - <video><source src="..."></video>  （複数ソース形式）
 *
 * 返り値: Map<url, { url, tag, type, mimeHint }>
 */
function collectMediaFromDOM() {
  const found = new Map();

  // <video> と <audio> 要素を対象にする
  const mediaElements = document.querySelectorAll("video, audio");

  for (const el of mediaElements) {
    const tag = el.tagName.toLowerCase(); // "video" or "audio"

    // (A) src 属性が直接ついているケース
    const directSrc = el.getAttribute("src");
    const directType = el.getAttribute("type") || "";
    const absoluteSrc = toAbsoluteURL(directSrc);
    if (absoluteSrc && isMediaCandidate(absoluteSrc, directType)) {
      if (!found.has(absoluteSrc)) {
        found.set(absoluteSrc, {
          url: absoluteSrc,
          tag,
          mimeHint: directType || inferMime(absoluteSrc),
          element: el,                    // DOM参照（サムネイル取得で使用予定）
        });
      }
    }

    // (B) 子の <source> 要素が複数あるケース（画質バリアント等）
    const sources = el.querySelectorAll("source");
    for (const source of sources) {
      const srcAttr = source.getAttribute("src");
      const typeAttr = source.getAttribute("type") || "";
      const absURL = toAbsoluteURL(srcAttr);
      if (absURL && isMediaCandidate(absURL, typeAttr)) {
        if (!found.has(absURL)) {
          found.set(absURL, {
            url: absURL,
            tag,
            mimeHint: typeAttr || inferMime(absURL),
            element: el,
          });
        }
      }
    }
  }

  return found;
}

// ─── MIME ヒント推測 ──────────────────────────────────────────────────────────

/** URL の拡張子から大まかな MIME タイプを推測する */
function inferMime(url) {
  const ext = (url.match(/\.([a-z0-9]+)(\?|$)/i) || [])[1]?.toLowerCase();
  const table = {
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    ogg: "video/ogg",
    ogv: "video/ogg",
    m4v: "video/mp4",
    m3u8: "application/x-mpegURL",
    mpd: "application/dash+xml",
    mp3: "audio/mpeg",
    aac: "audio/aac",
    flac: "audio/flac",
  };
  return table[ext] || "video/*";
}

// ─── Background への送信 ──────────────────────────────────────────────────────

/**
 * 収集した候補リストを background script に送信する。
 * element（DOM参照）はシリアライズできないので除外する。
 */
function sendToBackground(mediaMap) {
  if (mediaMap.size === 0) return;

  const items = [...mediaMap.values()].map(({ url, tag, mimeHint }) => ({
    url,
    tag,
    mimeHint,
    pageTitle: document.title,
    pageURL: location.href,
    detectedAt: Date.now(),
  }));

  browser.runtime.sendMessage({
    type: "MEDIA_FOUND",
    items,
  }).catch(() => {
    // ページ遷移直後などで background が応答しない場合は無視
  });
}

