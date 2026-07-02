/**
 * content-early.js  (v0.13.0 — ステップ13)
 * run_at: document_start — ページの JS より必ず先に実行される必要がある
 *
 * window.fetch と XMLHttpRequest.prototype を monkey-patch し、
 * メディアとみなせる URL / MIME のリクエストを background script へ通知する。
 *
 * ─── 目的 ─────────────────────────────────────────────────────────────────
 * <video src="blob:https://..."> のようにページが blob URL を動画ソースに使う場合、
 * webRequest.onResponseStarted は blob URL 自体を傍受できない。
 * しかしページが blob を生成するために呼んだ元の fetch / XHR は傍受可能。
 * そこでページの fetch / XHR を横取りし、メディアっぽいレスポンスを
 * background script に通知して「ダウンロード可能な実 URL」として記録する。
 *
 * ─── 設計上の注意 ──────────────────────────────────────────────────────────
 * - 無限ループ防止:
 *   background.js が呼ぶ fetch は拡張機能スコープの fetch であり、
 *   window.fetch（ページスコープ）ではないため、このラップは適用されない。
 * - blob: URL / data: URL は background からアクセス不可なので通知対象外。
 * - ページ動作を破壊しないよう、すべての monkey-patch 内処理を try/catch で囲む。
 * - document_start のためこの時点では document.title が取得できない。
 *   pageTitle は background 側で空文字として扱われる。
 */

"use strict";

// ─── メディア判定パターン ─────────────────────────────────────────────────────

const _MS_MEDIA_MIME_RE    = /^(video|audio)\//i;
const _MS_MANIFEST_MIME_RE =
  /^application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)/i;
const _MS_MEDIA_URL_RE     =
  /\.(mp4|webm|mkv|m4v|ts|m2ts|m4s|m3u8|mpd|ogg|ogv|mp3|aac|flac|opus|m4a|wav)(\?|#|$)/i;
const _MS_EXCLUDE_MIME_RE  =
  /^(image|text|font|application\/(javascript|json|xml$))/i;

/**
 * URL と Content-Type の組み合わせからメディアかどうかを判定する。
 *
 * @param {string} url
 * @param {string} mime - Content-Type ヘッダーの値（空文字可）
 * @returns {boolean}
 */
function _msIsMedia(url, mime) {
  if (mime && _MS_EXCLUDE_MIME_RE.test(mime)) return false;
  if (mime && (_MS_MEDIA_MIME_RE.test(mime) || _MS_MANIFEST_MIME_RE.test(mime))) return true;
  if (url  && _MS_MEDIA_URL_RE.test(url))   return true;
  return false;
}

// ─── URL / MIME ユーティリティ ────────────────────────────────────────────────

/**
 * 相対 URL を絶対 URL に変換する。
 * location.href は document_start でも参照可能。
 */
function _msResolveUrl(url) {
  if (!url) return "";
  try { return new URL(url, location.href).href; } catch (_) { return String(url); }
}

/** Content-Type の MIME 部分（セミコロン以前）だけを返す */
function _msNormMime(mime) {
  return mime ? mime.split(";")[0].trim() : "";
}

// ─── background への通知 ──────────────────────────────────────────────────────

/**
 * MEDIA_FOUND_BLOB を background に送信する。
 *
 * blob: URL や data: URL は background から参照できないため除外する。
 * ポップアップが閉じているなど送信に失敗しても無視する。
 *
 * @param {string} url
 * @param {string} mimeHint - 正規化済み MIME 文字列
 */
function _msNotify(url, mimeHint) {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return;
  try {
    browser.runtime.sendMessage({
      type:    "MEDIA_FOUND_BLOB",
      url,
      mimeHint,
      pageURL: location.href,
    }).catch(() => {});
  } catch (_) {}
}

// ─── window.fetch のラップ ────────────────────────────────────────────────────

/**
 * fetch() をラップし、メディアっぽいレスポンスを background に通知する。
 *
 * レスポンスを clone せず元のまま返すため、ページの動作には影響しない。
 * Response.headers は clone なしで読めるので body を消費しない。
 */
const _msOrigFetch = window.fetch;

window.fetch = async function(input, init) {
  // 元の fetch を必ず呼ぶ（エラーもそのまま伝播させる）
  const response = await _msOrigFetch.apply(this, arguments);

  try {
    const rawUrl = (input instanceof Request) ? input.url : String(input ?? "");
    const absUrl = _msResolveUrl(rawUrl);

    // blob: 同士の fetch（メディアキャッシュ等）は追跡不要
    if (absUrl.startsWith("blob:")) return response;

    const mime     = response.headers?.get("content-type") ?? "";
    const mimeHint = _msNormMime(mime);

    if (_msIsMedia(absUrl, mime)) {
      _msNotify(absUrl, mimeHint);
    }
  } catch (_) {
    // monkey-patch のエラーがページ動作を破壊しないよう握りつぶす
  }

  return response;
};

// ─── XMLHttpRequest のラップ ──────────────────────────────────────────────────

/**
 * XHR の open() をラップしてリクエスト URL を保持する。
 * send() で追加する load リスナーが参照する。
 */
const _msOrigXhrOpen = XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  try {
    // XHR インスタンスにリクエスト URL を付与（プロパティ名に接頭辞を付けて衝突回避）
    this._msReqUrl = _msResolveUrl(String(url ?? ""));
  } catch (_) {}
  return _msOrigXhrOpen.apply(this, [method, url, ...rest]);
};

/**
 * XHR の send() をラップし、レスポンス完了後に MIME と URL を検査する。
 *
 * addEventListener を使うことで、ページ側の onload 代入と競合しない。
 * { once: true } で自動解除されるためリークしない。
 *
 * responseURL はリダイレクト後の最終 URL を返すため、
 * _msReqUrl（元の URL）より正確な場合がある。
 */
const _msOrigXhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.send = function(...args) {
  try {
    this.addEventListener("load", () => {
      try {
        // responseURL が空でなければリダイレクト後の最終 URL を優先する
        const url = (this.responseURL || this._msReqUrl || "");
        if (!url || url.startsWith("blob:")) return;

        const mime     = this.getResponseHeader("content-type") ?? "";
        const mimeHint = _msNormMime(mime);

        if (_msIsMedia(url, mime)) {
          _msNotify(url, mimeHint);
        }
      } catch (_) {}
    }, { once: true });
  } catch (_) {}

  return _msOrigXhrSend.apply(this, args);
};
