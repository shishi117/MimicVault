/**
 * content.js
 * ページ内の <video> / <audio> / <source> タグを走査して
 * メディアURLを収集し、background scriptに送信する。
 */

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

// ─── MutationObserver — 動的に追加された要素も監視 ───────────────────────────

let observerTimer = null;

const observer = new MutationObserver(() => {
  // DOM 変更が連続する場合はまとめて 300ms 後に処理する
  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    const found = collectMediaFromDOM();
    sendToBackground(found);
  }, 300);
});

// ─── サムネイル生成（ステップ5） ─────────────────────────────────────────────

/**
 * ポップアップから CAPTURE_THUMBNAIL メッセージを受け取り、
 * 隠れ <video> 要素でフレームを取得して dataURL（JPEG）で返す。
 *
 * 成功: { ok: true,  dataURL: "data:image/jpeg;base64,..." }
 * 失敗: { ok: false, reason: "cors" | "load" | "timeout" }
 */
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "CAPTURE_THUMBNAIL") return false;

  captureThumbnail(message.url)
    .then(dataURL => sendResponse({ ok: true,  dataURL }))
    .catch(err   => sendResponse({ ok: false, reason: err.message }));

  return true; // 非同期 sendResponse を使うことを Firefox に宣言
});

/**
 * 隠れ <video> を DOM に追加し、seeked イベントで canvas にフレームを描画する。
 *
 * 手順:
 *   1. crossOrigin = "anonymous" で動画をロード（CORS ヘッダが必要）
 *   2. loadedmetadata イベントで尺を確認し、適切な位置にシーク
 *      - 有限尺: min(2秒, duration の10%) にシーク（OP や黒フレームを避ける）
 *      - 無限尺（ライブ等）: currentTime = 0 のまま待つ
 *   3. seeked イベントで canvas.drawImage → toDataURL("image/jpeg", 0.7)
 *   4. クロスオリジン汚染で SecurityError が出た場合は "cors" エラーとして reject
 *   5. 10秒以内に完了しない場合は "timeout" で reject
 */
async function captureThumbnail(url) {
  return new Promise((resolve, reject) => {
    // ── 隠れ video 要素を生成 ──
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted       = true;
    video.preload     = "metadata";
    // ページのレイアウトに影響しない位置へ
    video.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;";
    document.body.appendChild(video);

    const THUMB_W = 160;
    const THUMB_H = 90;

    let settled = false;

    const cleanup = () => {
      if (video.parentNode) video.parentNode.removeChild(video);
    };

    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };

    const fail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error(reason));
    };

    // ── タイムアウト（10秒） ──
    const timer = setTimeout(() => fail("timeout"), 10_000);

    // ── seeked: フレームを canvas に描画 ──
    video.addEventListener("seeked", () => {
      try {
        const vw = video.videoWidth  || THUMB_W;
        const vh = video.videoHeight || THUMB_H;

        // 動画のアスペクト比を保ちつつ THUMB_W × THUMB_H に収める（letterbox）
        const scale = Math.min(THUMB_W / vw, THUMB_H / vh);
        const dw = Math.round(vw * scale);
        const dh = Math.round(vh * scale);
        const dx = Math.round((THUMB_W - dw) / 2);
        const dy = Math.round((THUMB_H - dh) / 2);

        const canvas = document.createElement("canvas");
        canvas.width  = THUMB_W;
        canvas.height = THUMB_H;

        const ctx = canvas.getContext("2d");
        // 背景を黒で塗りつぶし（letterbox 部分）
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, THUMB_W, THUMB_H);
        ctx.drawImage(video, dx, dy, dw, dh);

        // クロスオリジン汚染チェック（ここで SecurityError が出る）
        const dataURL = canvas.toDataURL("image/jpeg", 0.7);
        done(dataURL);
      } catch (e) {
        // CORS 汚染の場合は SecurityError になる
        const reason = (e instanceof DOMException && e.name === "SecurityError")
          ? "cors" : "canvas";
        fail(reason);
      }
    }, { once: true });

    // ── loadedmetadata: シーク位置を決定 ──
    video.addEventListener("loadedmetadata", () => {
      const seekTo = isFinite(video.duration) && video.duration > 0
        ? Math.min(2, video.duration * 0.1)
        : 0;
      video.currentTime = seekTo;
    }, { once: true });

    // ── error: 動画ロード失敗（404・ネットワークエラー等） ──
    video.addEventListener("error", () => {
      fail("load");
    }, { once: true });

    // ── 動画ロード開始 ──
    video.src = url;
  });
}

const initial = collectMediaFromDOM();
sendToBackground(initial);

// 以降は DOM 変化を監視（動的ロードの動画に対応）
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
